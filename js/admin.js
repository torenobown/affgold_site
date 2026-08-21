(() => {
  const DRAFT_VERSION = 4;
  const STORAGE_KEY = 'affgold-projects-admin-draft-v4';
  const LEGACY_STORAGE_KEYS = ['affgold-projects-admin-draft-v3', 'affgold-projects-admin-draft-v2'];
  const DEFAULT_THEME = {
    primary: '#9767ff',
    secondary: '#b24dff',
    buttonStart: '#6433cc',
    buttonEnd: '#8a2fb5',
    onPrimary: '#ffffff'
  };
  const SCORE_FIELDS = {
    reliability: 'scoreReliability',
    bonuses: 'scoreBonuses',
    slots: 'scoreSlots',
    payouts: 'scorePayouts',
    support: 'scoreSupport'
  };
  const PROJECT_STATUSES = new Set(['draft', 'published', 'archived']);
  const STATUS_LABELS = { draft: 'Черновик', published: 'Опубликован', archived: 'Архив' };

  let sourceProjects = clone(window.AFFGOLD_PROJECTS || []);
  let sourceSignature = signature(sourceProjects);
  let draftMessage = '';
  let editor = { mode: 'checking', token: '', publishing: false };

  const list = document.querySelector('#admin-projects');
  const count = document.querySelector('#project-count');
  const status = document.querySelector('#admin-status');
  const dialog = document.querySelector('#project-dialog');
  const form = document.querySelector('#project-form');
  const error = document.querySelector('#form-error');
  const publishError = document.querySelector('#admin-publish-error');
  const title = document.querySelector('#dialog-title');
  const publishButton = document.querySelector('[data-publish]');
  const editorState = document.querySelector('[data-editor-state]');
  const editorStateTitle = document.querySelector('[data-editor-state-title]');
  const editorStateText = document.querySelector('[data-editor-state-text]');
  const localGuide = document.querySelector('[data-local-guide]');
  const staticGuide = document.querySelector('[data-static-guide]');

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function signature(value) {
    const source = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}-${Array.isArray(value) ? value.length : 0}`;
  }

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const parseList = (value = '') => [...new Set(String(value).split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
  const parseLines = (value = '') => [...new Set(String(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
  const logoSrc = (value = '') => /^data:image\/(?:png|jpeg|webp);base64,/i.test(value) ? value : `../${value}`;
  const today = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const projectStatus = (project) => PROJECT_STATUSES.has(project?.status) ? project.status : 'published';
  const formatSources = (sources = []) => sources.map((source) => [source.label, source.url, source.checkedAt].filter(Boolean).join(' | ')).join('\n');
  const formatChangelog = (entries = []) => entries.map((entry) => `${entry.date} | ${entry.note}`).join('\n');
  const normalizeRedirectAlias = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return `/${trimmed.replace(/^\/+/, '')}`;
  };
  const parseSources = (value = '') => parseLines(value).map((line, index) => {
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) {
      throw new Error(`Источник ${index + 1}: используйте формат «Название | https://адрес | YYYY-MM-DD».`);
    }
    return { label: parts[0], url: parts[1], ...(parts[2] ? { checkedAt: parts[2] } : {}) };
  });
  const parseChangelog = (value = '') => parseLines(value).map((line, index) => {
    const separator = line.indexOf('|');
    if (separator < 1 || !line.slice(separator + 1).trim()) {
      throw new Error(`Запись журнала ${index + 1}: используйте формат «YYYY-MM-DD | описание».`);
    }
    return { date: line.slice(0, separator).trim(), note: line.slice(separator + 1).trim() };
  });
  const averageScore = (project) => Math.round((Object.keys(SCORE_FIELDS)
    .reduce((total, key) => total + Number(project.scores?.[key] || 0), 0) / Object.keys(SCORE_FIELDS).length) * 10) / 10;
  const contentFingerprint = (project) => {
    const copy = clone(project || {});
    ['theme', 'status', 'lastUpdated', 'publishedAt', 'verifiedAt', 'changelog', 'redirectAliases'].forEach((key) => delete copy[key]);
    return JSON.stringify(copy);
  };
  const removeDraft = () => {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch { /* Приватный режим может запрещать локальное хранилище. */ }
  };

  const withDefaults = (project) => {
    const rating = Number(project?.rating ?? 4.5);
    return {
      ...project,
      status: projectStatus(project),
      publishedAt: project?.publishedAt || '',
      verifiedAt: project?.verifiedAt || '',
      offerExpiresAt: project?.offerExpiresAt || '',
      reviewerId: project?.reviewerId || '',
      operator: project?.operator || '',
      licenseAuthority: project?.licenseAuthority || '',
      licenseNumber: project?.licenseNumber || '',
      jurisdictions: Array.isArray(project?.jurisdictions) ? project.jurisdictions : [],
      sources: Array.isArray(project?.sources) ? project.sources : [],
      redirectAliases: Array.isArray(project?.redirectAliases) ? [...new Set(project.redirectAliases)] : [],
      changelog: Array.isArray(project?.changelog) ? project.changelog : [],
      scores: {
        reliability: rating,
        bonuses: rating,
        slots: rating,
        payouts: rating,
        support: rating,
        ...(project?.scores || {})
      },
      theme: Object.fromEntries(Object.entries(DEFAULT_THEME).map(([key, fallback]) => [
        key,
        safeColor(project?.theme?.[key], fallback)
      ]))
    };
  };

  const loadDraft = () => {
    try {
      LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
      const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!draft) return clone(sourceProjects).map(withDefaults);
      if (draft.version !== DRAFT_VERSION || draft.sourceSignature !== sourceSignature || !Array.isArray(draft.projects)) {
        removeDraft();
        draftMessage = 'Устаревший черновик не загружен: файл базы уже изменился';
        return clone(sourceProjects).map(withDefaults);
      }
      draftMessage = `Черновик восстановлен${draft.savedAt ? ` от ${new Date(draft.savedAt).toLocaleString('ru-RU')}` : ''}`;
      return clone(draft.projects).map(withDefaults);
    } catch {
      removeDraft();
      draftMessage = 'Повреждённый черновик удалён';
      return clone(sourceProjects).map(withDefaults);
    }
  };

  let projects = loadDraft();

  const setStatus = (message, persistent = false) => {
    status.textContent = message;
    clearTimeout(setStatus.timer);
    if (!persistent) setStatus.timer = setTimeout(() => {
      status.textContent = editor.mode === 'local'
        ? 'Черновик сохранён. Для публикации нажмите «Сохранить и пересобрать»'
        : 'Черновик сохранён в этом браузере';
    }, 2600);
  };

  const showPublishError = (message = '') => {
    publishError.hidden = !message;
    publishError.textContent = message;
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: DRAFT_VERSION,
        sourceSignature,
        savedAt: new Date().toISOString(),
        projects
      }));
      setStatus('Изменения сохранены в черновик');
    } catch {
      setStatus('Не удалось сохранить черновик: хранилище браузера заполнено', true);
    }
  };

  const databaseSource = () => {
    const json = JSON.stringify(projects, null, 2).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    return `/**\n * Единая база проектов.\n * Редактируйте через /admin/ и запускайте пересборку сайта.\n */\nwindow.AFFGOLD_PROJECTS = ${json};\n`;
  };

  const downloadDatabase = () => {
    const blob = new Blob([databaseSource()], { type: 'text/javascript;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'projects-data.js';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus('Файл projects-data.js скачан');
  };

  const saveDatabaseFile = async () => {
    if (!window.showSaveFilePicker) { downloadDatabase(); return; }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'projects-data.js',
        types: [{ description: 'JavaScript база проектов', accept: { 'text/javascript': ['.js'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(databaseSource());
      await writable.close();
      setStatus('Файл базы успешно сохранён');
    } catch (event) {
      if (event.name !== 'AbortError') setStatus('Не удалось сохранить файл — используйте скачивание', true);
    }
  };

  const setEditorMode = (mode, heading, message) => {
    editor.mode = mode;
    editorState.dataset.mode = mode;
    editorStateTitle.textContent = heading;
    editorStateText.textContent = message;
    const local = mode === 'local';
    localGuide.hidden = !local;
    staticGuide.hidden = local;
    publishButton.disabled = !local || editor.publishing;
    field('logoFile').disabled = !local;
    if (!local) field('logoFile').value = '';
  };

  const detectLocalEditor = async () => {
    try {
      const response = await fetch('/api/admin/status', { cache: 'no-store', headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || data.mode !== 'local' || !data.token) throw new Error('Local editor unavailable');
      if (data.sourceSignature !== sourceSignature) {
        editor.token = '';
        setEditorMode('stale', 'Файл базы изменился', 'Обновите эту страницу, чтобы не перезаписать более свежие проекты.');
        setStatus('Публикация заблокирована до обновления страницы', true);
        return;
      }
      editor.token = data.token;
      editor.publishing = Boolean(data.publishing);
      setEditorMode('local', 'Локальный редактор подключён', editor.publishing
        ? 'Сборка уже выполняется. Дождитесь завершения.'
        : 'Доступно безопасное сохранение файла и автоматическая пересборка сайта.');
    } catch {
      editor.token = '';
      setEditorMode('static', 'Статический режим', 'Прямое сохранение недоступно. Используйте экспорт файла и rebuild-site.bat.');
    }
  };

  const publish = async () => {
    if (editor.mode !== 'local' || !editor.token || editor.publishing) return;
    showPublishError();
    editor.publishing = true;
    publishButton.disabled = true;
    const oldLabel = publishButton.textContent;
    publishButton.textContent = 'Сохраняем и собираем…';
    setStatus('Проверяем данные и пересобираем страницы…', true);
    try {
      const response = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AFFGOLD-Admin-Token': editor.token
        },
        body: JSON.stringify({ sourceSignature, projects })
      });
      const data = await response.json().catch(() => ({ message: 'Локальный редактор вернул некорректный ответ.' }));
      if (!response.ok) {
        if (response.status === 409) {
          editor.token = '';
          setEditorMode('stale', 'Файл базы изменился', 'Обновите страницу перед повторной публикацией.');
        }
        throw new Error([data.message, data.details].filter(Boolean).join('\n\n'));
      }
      projects = clone(data.projects || projects).map(withDefaults);
      sourceProjects = clone(projects);
      sourceSignature = data.sourceSignature;
      removeDraft();
      render();
      setStatus(data.message || 'База сохранена, сайт пересобран', true);
      setEditorMode('local', 'Изменения опубликованы локально', `Сборка завершена ${new Date(data.publishedAt).toLocaleString('ru-RU')}.`);
    } catch (event) {
      showPublishError(event.message || 'Не удалось сохранить и пересобрать сайт.');
      setStatus('Публикация не выполнена — данные черновика сохранены', true);
    } finally {
      editor.publishing = false;
      publishButton.textContent = oldLabel;
      publishButton.disabled = editor.mode !== 'local';
    }
  };

  const render = () => {
    const statusCounts = projects.reduce((result, project) => {
      result[projectStatus(project)] += 1;
      return result;
    }, { draft: 0, published: 0, archived: 0 });
    count.textContent = `Проектов: ${projects.length} · опубликовано ${statusCounts.published} · черновиков ${statusCounts.draft} · в архиве ${statusCounts.archived}`;
    if (!projects.length) {
      list.innerHTML = '<div class="card admin-empty">Список пуст. Нажмите «Добавить проект».</div>';
      return;
    }
    list.innerHTML = projects.map((project, index) => {
      const normalized = withDefaults(project);
      const theme = normalized.theme;
      const currentStatus = normalized.status;
      const expiration = normalized.offerExpiresAt && normalized.offerExpiresAt < today()
        ? '<span class="admin-project-expired">Оффер просрочен</span>'
        : '';
      const destructiveAction = currentStatus === 'published'
        ? `<button class="btn btn-secondary btn-sm admin-delete" type="button" data-delete="${index}">В архив</button>`
        : currentStatus === 'draft' && !normalized.publishedAt
          ? `<button class="btn btn-secondary btn-sm admin-delete" type="button" data-delete="${index}">Удалить черновик</button>`
          : '<span class="admin-archived-note">Сохранён для истории</span>';
      return `
      <article class="card admin-project-row" data-status="${currentStatus}">
        <img src="${escapeHtml(logoSrc(project.logo || 'assets/icons/favicon.svg'))}" alt="${escapeHtml(project.name)}">
        <div><div class="admin-project-title"><h2>${escapeHtml(project.name)}</h2><span class="admin-status-badge admin-status-badge--${currentStatus}">${STATUS_LABELS[currentStatus]}</span><span class="admin-theme-dot" style="--admin-theme:${safeColor(theme.primary, DEFAULT_THEME.primary)}" title="Основной цвет"></span><span class="admin-theme-dot" style="--admin-theme:${safeColor(theme.secondary, DEFAULT_THEME.secondary)}" title="Дополнительный цвет"></span></div><p>${escapeHtml(project.url || 'Офферная ссылка не указана')}</p><div class="admin-project-meta"><span>${escapeHtml(project.bonus)}</span><span>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</span><span>★ ${Number(project.rating || 0).toFixed(1)}</span>${expiration}</div></div>
        <div class="admin-row-actions"><button class="btn btn-secondary btn-sm" type="button" data-edit="${index}">Изменить</button><button class="btn btn-secondary btn-sm" type="button" data-duplicate="${index}">Дублировать</button>${destructiveAction}</div>
      </article>`;
    }).join('');
  };

  const field = (name) => form.elements.namedItem(name);

  const updateCalculatedRating = () => {
    const scores = Object.fromEntries(Object.entries(SCORE_FIELDS).map(([key, input]) => [key, Number(field(input).value)]));
    field('rating').value = averageScore({ scores }).toFixed(1);
  };

  const openForm = (index = -1) => {
    form.reset();
    error.hidden = true;
    field('editIndex').value = String(index);
    const project = index >= 0 ? withDefaults(projects[index]) : null;
    title.textContent = project ? `Изменить ${project.name}` : 'Новый проект';
    const defaults = project || withDefaults({
      id: '', slug: '', status: 'draft', lastUpdated: today(), publishedAt: '', verifiedAt: '', offerExpiresAt: '', reviewerId: '',
      name: '', logo: 'assets/icons/favicon.svg', url: '', promoCode: 'BETGOLDTEAM', rating: 4.5,
      verdict: 'Хорошо', bonus: '', bonusSubtitle: 'На первый депозит', wager: 35,
      bonusTypes: ['welcome', 'freespins'], payout: 'hour', payoutLabel: 'До 1 часа',
      tags: ['Мобильная версия'], description: '', features: [], payments: ['VISA', 'Mastercard'],
      operator: '', licenseAuthority: '', licenseNumber: '', jurisdictions: [], sources: [], redirectAliases: [], changelog: [],
      tabs: { bonuses: '', slots: '', payments: '' }
    });
    ['status', 'reviewerId', 'lastUpdated', 'publishedAt', 'verifiedAt', 'offerExpiresAt', 'id', 'slug', 'name', 'logo', 'url', 'promoCode', 'rating', 'verdict', 'bonus', 'bonusSubtitle', 'wager', 'payout', 'payoutLabel', 'description', 'operator', 'licenseAuthority', 'licenseNumber']
      .forEach((name) => { field(name).value = defaults[name] ?? ''; });
    field('bonusTypes').value = (defaults.bonusTypes || []).join(', ');
    field('tags').value = (defaults.tags || []).join(', ');
    field('features').value = (defaults.features || []).join('\n');
    field('payments').value = (defaults.payments || []).join(', ');
    field('jurisdictions').value = (defaults.jurisdictions || []).join(', ');
    field('sources').value = formatSources(defaults.sources);
    field('redirectAliases').value = (defaults.redirectAliases || []).join('\n');
    field('changelog').value = formatChangelog(defaults.changelog);
    field('changeNote').value = '';
    field('confirmAddressChange').checked = false;
    field('tabBonuses').value = defaults.tabs?.bonuses || '';
    field('tabSlots').value = defaults.tabs?.slots || '';
    field('tabPayments').value = defaults.tabs?.payments || '';
    Object.entries(SCORE_FIELDS).forEach(([key, input]) => { field(input).value = defaults.scores[key]; });
    field('themePrimary').value = defaults.theme.primary;
    field('themeSecondary').value = defaults.theme.secondary;
    field('themeButtonStart').value = defaults.theme.buttonStart;
    field('themeButtonEnd').value = defaults.theme.buttonEnd;
    field('themeOnPrimary').value = defaults.theme.onPrimary;
    const protectedIdentity = Boolean(project && (projectStatus(project) !== 'draft' || project.publishedAt));
    field('id').readOnly = protectedIdentity;
    document.querySelector('[data-id-help]').textContent = protectedIdentity
      ? 'ID уже опубликован и защищён от изменения.'
      : 'После публикации ID фиксируется навсегда.';
    document.querySelector('[data-seo-guard]').hidden = !protectedIdentity;
    updateCalculatedRating();
    dialog.showModal();
  };

  const closeForm = () => dialog.close();

  const readProject = () => {
    const index = Number(field('editIndex').value);
    const previous = index >= 0 ? withDefaults(projects[index]) : {};
    const scores = Object.fromEntries(Object.entries(SCORE_FIELDS).map(([key, input]) => [key, Number(field(input).value)]));
    const statusValue = field('status').value;
    const redirectAliases = parseLines(field('redirectAliases').value).map(normalizeRedirectAlias);
    const project = {
      ...previous,
      status: statusValue,
      publishedAt: field('publishedAt').value,
      verifiedAt: field('verifiedAt').value,
      offerExpiresAt: field('offerExpiresAt').value,
      reviewerId: field('reviewerId').value.trim().toLowerCase(),
      id: field('id').value.trim().toLowerCase(),
      slug: field('slug').value.trim().toLowerCase(),
      lastUpdated: previous.lastUpdated || today(),
      name: field('name').value.trim(),
      logo: field('logo').value.trim(),
      theme: {
        primary: field('themePrimary').value.toLowerCase(),
        secondary: field('themeSecondary').value.toLowerCase(),
        buttonStart: field('themeButtonStart').value.toLowerCase(),
        buttonEnd: field('themeButtonEnd').value.toLowerCase(),
        onPrimary: field('themeOnPrimary').value.toLowerCase()
      },
      rating: averageScore({ scores }),
      verdict: field('verdict').value.trim(),
      bonus: field('bonus').value.trim(),
      promoCode: field('promoCode').value.trim() || 'BETGOLDTEAM',
      bonusSubtitle: field('bonusSubtitle').value.trim(),
      wager: Number(field('wager').value),
      bonusTypes: parseList(field('bonusTypes').value),
      payout: field('payout').value,
      payoutLabel: field('payoutLabel').value.trim(),
      url: field('url').value.trim(),
      tags: parseList(field('tags').value),
      description: field('description').value.trim(),
      features: parseLines(field('features').value),
      scores,
      tabs: {
        bonuses: field('tabBonuses').value.trim(),
        slots: field('tabSlots').value.trim(),
        payments: field('tabPayments').value.trim()
      },
      payments: parseList(field('payments').value),
      operator: field('operator').value.trim(),
      licenseAuthority: field('licenseAuthority').value.trim(),
      licenseNumber: field('licenseNumber').value.trim(),
      jurisdictions: parseList(field('jurisdictions').value),
      sources: parseSources(field('sources').value),
      redirectAliases: [...new Set(redirectAliases)],
      changelog: parseChangelog(field('changelog').value)
    };

    if (index < 0 || contentFingerprint(project) !== contentFingerprint(previous)) project.lastUpdated = today();
    if (statusValue === 'published' && !project.publishedAt && (index < 0 || projectStatus(previous) !== 'published')) {
      project.publishedAt = today();
    }
    if (previous.slug && previous.slug !== project.slug) {
      project.redirectAliases = [...new Set([...project.redirectAliases, `/reviews/${previous.slug}/`])];
    }
    const changeNote = field('changeNote').value.trim();
    if (changeNote) project.changelog.push({ date: today(), note: changeNote });
    if (previous.status && previous.status !== project.status) {
      project.changelog.push({ date: today(), note: `Статус изменён: ${STATUS_LABELS[previous.status]} → ${STATUS_LABELS[project.status]}` });
    }
    return project;
  };

  const uniqueCopyKey = (base, key) => {
    const normalized = `${base}-copy`.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'project-copy';
    let result = normalized;
    let suffix = 2;
    while (projects.some((project) => project[key] === result)) {
      result = `${normalized}-${suffix}`;
      suffix += 1;
    }
    return result;
  };

  const duplicateProject = (index) => {
    const original = projects[index];
    const copy = clone(original);
    copy.id = uniqueCopyKey(original.id, 'id');
    copy.slug = uniqueCopyKey(original.slug || original.id, 'slug');
    copy.name = `${original.name} — копия`;
    copy.status = 'draft';
    copy.publishedAt = '';
    copy.verifiedAt = '';
    copy.offerExpiresAt = '';
    copy.redirectAliases = [];
    copy.changelog = [{ date: today(), note: `Создан черновик на основе «${original.name}»` }];
    copy.lastUpdated = today();
    projects.splice(index + 1, 0, copy);
    saveDraft();
    render();
    openForm(index + 1);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const index = Number(field('editIndex').value);
    const previous = index >= 0 ? withDefaults(projects[index]) : null;
    let project;
    try {
      project = readProject();
    } catch (parseError) {
      error.textContent = parseError.message || 'Проверьте формат источников и журнала изменений.';
      error.hidden = false;
      return;
    }
    try {
      const offerUrl = new URL(project.url);
      if (offerUrl.protocol !== 'https:' || offerUrl.username || offerUrl.password) throw new Error('HTTPS required');
    } catch {
      error.textContent = 'Офферная ссылка должна быть полным безопасным адресом https://…';
      error.hidden = false;
      return;
    }
    for (const [sourceIndex, source] of project.sources.entries()) {
      try {
        const sourceUrl = new URL(source.url);
        if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) throw new Error('HTTPS required');
      } catch {
        error.textContent = `Источник ${sourceIndex + 1}: укажите полный безопасный адрес https://…`;
        error.hidden = false;
        return;
      }
      if (source.checkedAt && !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt)) {
        error.textContent = `Источник ${sourceIndex + 1}: дата проверки должна иметь формат YYYY-MM-DD.`;
        error.hidden = false;
        return;
      }
    }
    if (previous && (projectStatus(previous) !== 'draft' || previous.publishedAt)) {
      if (project.id !== previous.id) {
        error.textContent = 'ID опубликованного проекта менять нельзя. Для нового проекта используйте «Дублировать».';
        error.hidden = false;
        return;
      }
      if (project.slug !== previous.slug && !field('confirmAddressChange').checked) {
        error.textContent = 'Подтвердите смену опубликованного SEO-адреса. Старый путь будет сохранён для редиректа.';
        error.hidden = false;
        return;
      }
    }
    if (previous && projectStatus(previous) !== 'draft' && project.status === 'draft') {
      error.textContent = 'Ранее опубликованный проект нельзя вернуть в черновик. Используйте архив или опубликуйте его снова.';
      error.hidden = false;
      return;
    }
    if (projects.some((item, itemIndex) => itemIndex !== index && item.id === project.id)) {
      error.textContent = `ID «${project.id}» уже используется другим проектом.`;
      error.hidden = false;
      return;
    }
    if (projects.some((item, itemIndex) => itemIndex !== index && item.slug === project.slug)) {
      error.textContent = `Адрес «${project.slug}» уже используется другим проектом.`;
      error.hidden = false;
      return;
    }
    if (!project.bonusTypes.length) {
      error.textContent = 'Укажите хотя бы один тип бонуса.';
      error.hidden = false;
      return;
    }
    const newlyPublished = project.status === 'published' && (!previous || projectStatus(previous) !== 'published');
    if (newlyPublished && (!project.reviewerId || !project.verifiedAt || !project.sources.length || project.sources.some((source) => !source.checkedAt))) {
      error.textContent = 'Перед публикацией укажите ответственного редактора, дату проверки и хотя бы один источник с датой проверки.';
      error.hidden = false;
      return;
    }
    if (index >= 0) projects[index] = project;
    else projects.push(project);
    saveDraft();
    render();
    closeForm();
  });

  list.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) { openForm(Number(edit.dataset.edit)); return; }
    const duplicate = event.target.closest('[data-duplicate]');
    if (duplicate) { duplicateProject(Number(duplicate.dataset.duplicate)); return; }
    const remove = event.target.closest('[data-delete]');
    if (!remove) return;
    const index = Number(remove.dataset.delete);
    const project = withDefaults(projects[index]);
    if (project.status === 'published') {
      if (!confirm(`Перевести опубликованный проект «${project.name}» в архив? Его данные и SEO-история сохранятся.`)) return;
      projects[index] = {
        ...project,
        status: 'archived',
        changelog: [...project.changelog, { date: today(), note: 'Проект переведён в архив' }]
      };
    } else {
      if (projects.length === 1) {
        setStatus('В базе должен остаться хотя бы один проект', true);
        return;
      }
      if (!confirm(`Удалить неопубликованный черновик «${project.name}»?`)) return;
      projects.splice(index, 1);
    }
    saveDraft();
    render();
  });

  document.querySelector('[data-add]').addEventListener('click', () => openForm());
  Object.values(SCORE_FIELDS).forEach((input) => field(input).addEventListener('input', updateCalculatedRating));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', closeForm));
  document.querySelector('[data-download]').addEventListener('click', downloadDatabase);
  document.querySelector('[data-save-file]').addEventListener('click', saveDatabaseFile);
  publishButton.addEventListener('click', publish);
  document.querySelector('[data-reset]').addEventListener('click', () => {
    if (!confirm('Удалить черновик и вернуть данные из текущего файла?')) return;
    projects = clone(sourceProjects).map(withDefaults);
    removeDraft();
    render();
    showPublishError();
    setStatus('Черновик сброшен');
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeForm(); });
  field('logoFile').addEventListener('change', () => {
    const file = field('logoFile').files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      error.textContent = 'Для безопасной загрузки используйте PNG, JPEG или WebP.';
      error.hidden = false;
      field('logoFile').value = '';
      return;
    }
    if (file.size > 128 * 1024) {
      error.textContent = 'Логотип больше 128 КБ. Сожмите файл или выберите другой.';
      error.hidden = false;
      field('logoFile').value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      field('logo').value = reader.result;
      error.hidden = true;
    });
    reader.readAsDataURL(file);
  });

  render();
  if (draftMessage) setStatus(draftMessage, true);
  detectLocalEditor();
})();
