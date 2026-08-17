(() => {
  const DRAFT_VERSION = 3;
  const STORAGE_KEY = 'affgold-projects-admin-draft-v3';
  const LEGACY_STORAGE_KEYS = ['affgold-projects-admin-draft-v2'];
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
  const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
  const logoSrc = (value = '') => /^(data:image\/(?:png|jpeg|webp);base64,|https?:)/i.test(value) ? value : `../${value}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const removeDraft = () => {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch { /* Приватный режим может запрещать локальное хранилище. */ }
  };

  const withDefaults = (project) => {
    const rating = Number(project?.rating ?? 4.5);
    return {
      ...project,
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
    count.textContent = `Проектов: ${projects.length}`;
    if (!projects.length) {
      list.innerHTML = '<div class="card admin-empty">Список пуст. Нажмите «Добавить проект».</div>';
      return;
    }
    list.innerHTML = projects.map((project, index) => {
      const theme = withDefaults(project).theme;
      return `
      <article class="card admin-project-row">
        <img src="${escapeHtml(logoSrc(project.logo || 'assets/icons/favicon.svg'))}" alt="${escapeHtml(project.name)}">
        <div><div class="admin-project-title"><h2>${escapeHtml(project.name)}</h2><span class="admin-theme-dot" style="--admin-theme:${safeColor(theme.primary, DEFAULT_THEME.primary)}" title="Основной цвет"></span><span class="admin-theme-dot" style="--admin-theme:${safeColor(theme.secondary, DEFAULT_THEME.secondary)}" title="Дополнительный цвет"></span></div><p>${escapeHtml(project.url || 'Офферная ссылка не указана')}</p><div class="admin-project-meta"><span>${escapeHtml(project.bonus)}</span><span>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</span><span>★ ${Number(project.rating || 0).toFixed(1)}</span></div></div>
        <div class="admin-row-actions"><button class="btn btn-secondary btn-sm" type="button" data-edit="${index}">Изменить</button><button class="btn btn-secondary btn-sm" type="button" data-duplicate="${index}">Дублировать</button><button class="btn btn-secondary btn-sm admin-delete" type="button" data-delete="${index}">Удалить</button></div>
      </article>`;
    }).join('');
  };

  const field = (name) => form.elements.namedItem(name);

  const openForm = (index = -1) => {
    form.reset();
    error.hidden = true;
    field('editIndex').value = String(index);
    const project = index >= 0 ? withDefaults(projects[index]) : null;
    title.textContent = project ? `Изменить ${project.name}` : 'Новый проект';
    const defaults = project || withDefaults({
      id: '', slug: '', lastUpdated: today(), name: '', logo: 'assets/icons/favicon.svg', url: '', promoCode: 'BETGOLDTEAM', rating: 4.5,
      verdict: 'Хорошо', bonus: '', bonusSubtitle: 'На первый депозит', wager: 35,
      bonusTypes: ['welcome', 'freespins'], payout: 'hour', payoutLabel: 'До 1 часа',
      tags: ['Мобильная версия'], description: '', features: [], payments: ['VISA', 'Mastercard'],
      tabs: { bonuses: '', slots: '', payments: '' }
    });
    ['id', 'slug', 'name', 'logo', 'url', 'promoCode', 'rating', 'verdict', 'bonus', 'bonusSubtitle', 'wager', 'payout', 'payoutLabel', 'description']
      .forEach((name) => { field(name).value = defaults[name] ?? ''; });
    field('bonusTypes').value = (defaults.bonusTypes || []).join(', ');
    field('tags').value = (defaults.tags || []).join(', ');
    field('features').value = (defaults.features || []).join('\n');
    field('payments').value = (defaults.payments || []).join(', ');
    field('tabBonuses').value = defaults.tabs?.bonuses || '';
    field('tabSlots').value = defaults.tabs?.slots || '';
    field('tabPayments').value = defaults.tabs?.payments || '';
    Object.entries(SCORE_FIELDS).forEach(([key, input]) => { field(input).value = defaults.scores[key]; });
    field('themePrimary').value = defaults.theme.primary;
    field('themeSecondary').value = defaults.theme.secondary;
    field('themeButtonStart').value = defaults.theme.buttonStart;
    field('themeButtonEnd').value = defaults.theme.buttonEnd;
    field('themeOnPrimary').value = defaults.theme.onPrimary;
    dialog.showModal();
  };

  const closeForm = () => dialog.close();

  const readProject = () => {
    const index = Number(field('editIndex').value);
    const previous = index >= 0 ? projects[index] : {};
    return {
      ...previous,
      id: field('id').value.trim().toLowerCase(),
      slug: field('slug').value.trim().toLowerCase(),
      lastUpdated: today(),
      name: field('name').value.trim(),
      logo: field('logo').value.trim(),
      theme: {
        primary: field('themePrimary').value.toLowerCase(),
        secondary: field('themeSecondary').value.toLowerCase(),
        buttonStart: field('themeButtonStart').value.toLowerCase(),
        buttonEnd: field('themeButtonEnd').value.toLowerCase(),
        onPrimary: field('themeOnPrimary').value.toLowerCase()
      },
      rating: Number(field('rating').value),
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
      features: parseList(field('features').value),
      scores: Object.fromEntries(Object.entries(SCORE_FIELDS).map(([key, input]) => [key, Number(field(input).value)])),
      tabs: {
        bonuses: field('tabBonuses').value.trim(),
        slots: field('tabSlots').value.trim(),
        payments: field('tabPayments').value.trim()
      },
      payments: parseList(field('payments').value)
    };
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
    const project = readProject();
    try {
      if (new URL(project.url).protocol !== 'https:') throw new Error('HTTPS required');
    } catch {
      error.textContent = 'Офферная ссылка должна быть полным безопасным адресом https://…';
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
    if (projects.length === 1) {
      setStatus('В базе должен остаться хотя бы один проект', true);
      return;
    }
    if (!confirm(`Удалить проект «${projects[index].name}»?`)) return;
    projects.splice(index, 1);
    saveDraft();
    render();
  });

  document.querySelector('[data-add]').addEventListener('click', () => openForm());
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
