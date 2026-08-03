(() => {
  const STORAGE_KEY = 'affgold-projects-admin-draft-v2';
  const sourceProjects = JSON.parse(JSON.stringify(window.AFFGOLD_PROJECTS || []));
  const list = document.querySelector('#admin-projects');
  const count = document.querySelector('#project-count');
  const status = document.querySelector('#admin-status');
  const dialog = document.querySelector('#project-dialog');
  const form = document.querySelector('#project-form');
  const error = document.querySelector('#form-error');
  const title = document.querySelector('#dialog-title');

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const parseList = (value = '') => [...new Set(String(value).split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
  const logoSrc = (value = '') => /^(data:|https?:)/i.test(value) ? value : `../${value}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const normalizeProject = (project) => {
    const studios = Array.isArray(project.studios)
      ? project.studios.filter(Boolean)
      : (project.provider ? [project.provider] : []);
    const { provider: legacyProvider, ...rest } = project;
    return { ...rest, studios };
  };
  const loadDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return (Array.isArray(draft) ? draft : clone(sourceProjects)).map(normalizeProject);
    } catch { return clone(sourceProjects).map(normalizeProject); }
  };
  let projects = loadDraft();

  const setStatus = (message) => {
    status.textContent = message;
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => { status.textContent = 'Черновик сохранён в этом браузере'; }, 2200);
  };

  const saveDraft = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    setStatus('Изменения сохранены в черновик');
  };

  const databaseSource = () => `/**\n * Единая база проектов. Файл сформирован через /admin/.\n */\nwindow.AFFGOLD_PROJECTS = ${JSON.stringify(projects, null, 2)};\n`;

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
      if (event.name !== 'AbortError') { setStatus('Не удалось сохранить файл — используйте скачивание'); }
    }
  };

  const render = () => {
    count.textContent = `Проектов: ${projects.length}`;
    if (!projects.length) {
      list.innerHTML = '<div class="card admin-empty">Список пуст. Нажмите «Добавить проект».</div>';
      return;
    }
    list.innerHTML = projects.map((project, index) => `
      <article class="card admin-project-row">
        <img src="${escapeHtml(logoSrc(project.logo || 'assets/icons/favicon.svg'))}" alt="${escapeHtml(project.name)}">
        <div><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.url || 'Офферная ссылка не указана')}</p><div class="admin-project-meta"><span>${escapeHtml(project.bonus)}</span><span>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</span><span>Студий: ${(project.studios || []).length}</span><span>★ ${Number(project.rating || 0).toFixed(1)}</span></div></div>
        <div class="admin-row-actions"><button class="btn btn-secondary btn-sm" type="button" data-edit="${index}">Изменить</button><button class="btn btn-secondary btn-sm admin-delete" type="button" data-delete="${index}">Удалить</button></div>
      </article>`).join('');
  };

  const field = (name) => form.elements.namedItem(name);
  const openForm = (index = -1) => {
    form.reset();
    error.hidden = true;
    field('editIndex').value = String(index);
    const project = index >= 0 ? projects[index] : null;
    title.textContent = project ? `Изменить ${project.name}` : 'Новый проект';
    const defaults = project || {
      id: '', slug: '', name: '', logo: 'assets/icons/favicon.svg', url: '', promoCode: 'BETGOLDTEAM', rating: 4.5,
      verdict: 'Хорошо', bonus: '', bonusSubtitle: 'На первый депозит', wager: 35,
      bonusTypes: ['welcome','freespins'], studios: [], payout: 'hour', payoutLabel: 'До 1 часа',
      tags: ['Мобильная версия'], description: '', features: [], payments: ['VISA','Mastercard'],
      tabs: { bonuses: '', slots: '', payments: '' }
    };
    ['id','slug','name','logo','url','promoCode','rating','verdict','bonus','bonusSubtitle','wager','payout','payoutLabel','description'].forEach((name) => { field(name).value = defaults[name] ?? ''; });
    field('studios').value = (defaults.studios || (defaults.provider ? [defaults.provider] : [])).join(', ');
    field('bonusTypes').value = (defaults.bonusTypes || []).join(', ');
    field('tags').value = (defaults.tags || []).join(', ');
    field('features').value = (defaults.features || []).join('\n');
    field('payments').value = (defaults.payments || []).join(', ');
    field('tabBonuses').value = defaults.tabs?.bonuses || '';
    field('tabSlots').value = defaults.tabs?.slots || '';
    field('tabPayments').value = defaults.tabs?.payments || '';
    dialog.showModal();
  };

  const closeForm = () => dialog.close();

  const readProject = () => {
    const index = Number(field('editIndex').value);
    const previous = index >= 0 ? projects[index] : {};
    const rating = Number(field('rating').value) || 0;
    return {
      ...previous,
      id: field('id').value.trim().toLowerCase(),
      slug: field('slug').value.trim().toLowerCase(),
      lastUpdated: new Date().toISOString().slice(0, 10),
      name: field('name').value.trim(),
      logo: field('logo').value.trim(),
      rating,
      verdict: field('verdict').value.trim(),
      bonus: field('bonus').value.trim(),
      promoCode: field('promoCode').value.trim() || 'BETGOLDTEAM',
      bonusSubtitle: field('bonusSubtitle').value.trim(),
      wager: Number(field('wager').value) || 0,
      bonusTypes: parseList(field('bonusTypes').value),
      studios: parseList(field('studios').value),
      payout: field('payout').value,
      payoutLabel: field('payoutLabel').value.trim(),
      url: field('url').value.trim(),
      tags: parseList(field('tags').value),
      description: field('description').value.trim(),
      features: parseList(field('features').value),
      scores: previous.scores || { reliability: rating, bonuses: rating, slots: rating, payouts: rating, support: rating },
      tabs: { bonuses: field('tabBonuses').value.trim(), slots: field('tabSlots').value.trim(), payments: field('tabPayments').value.trim() },
      payments: parseList(field('payments').value)
    };
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const index = Number(field('editIndex').value);
    const project = readProject();
    if (!project.studios.length) {
      error.textContent = 'Добавьте хотя бы одну игровую студию.'; error.hidden = false; return;
    }
    try {
      if (new URL(project.url).protocol !== 'https:') throw new Error('HTTPS required');
    } catch {
      error.textContent = 'Офферная ссылка должна быть полным безопасным адресом https://…'; error.hidden = false; return;
    }
    if (projects.some((item, itemIndex) => itemIndex !== index && item.id === project.id)) {
      error.textContent = `ID «${project.id}» уже используется другим проектом.`; error.hidden = false; return;
    }
    if (projects.some((item, itemIndex) => itemIndex !== index && item.slug === project.slug)) {
      error.textContent = `Адрес «${project.slug}» уже используется другим проектом.`; error.hidden = false; return;
    }
    if (index >= 0) projects[index] = project; else projects.push(project);
    saveDraft(); render(); closeForm();
  });

  list.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) { openForm(Number(edit.dataset.edit)); return; }
    const remove = event.target.closest('[data-delete]');
    if (!remove) return;
    const index = Number(remove.dataset.delete);
    if (!confirm(`Удалить проект «${projects[index].name}»?`)) return;
    projects.splice(index, 1); saveDraft(); render();
  });

  document.querySelector('[data-add]').addEventListener('click', () => openForm());
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', closeForm));
  document.querySelector('[data-download]').addEventListener('click', downloadDatabase);
  document.querySelector('[data-save-file]').addEventListener('click', saveDatabaseFile);
  document.querySelector('[data-reset]').addEventListener('click', () => {
    if (!confirm('Удалить черновик и вернуть данные из текущего файла?')) return;
    projects = clone(sourceProjects).map(normalizeProject); localStorage.removeItem(STORAGE_KEY); render(); setStatus('Черновик сброшен');
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeForm(); });
  field('logoFile').addEventListener('change', () => {
    const file = field('logoFile').files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { error.textContent = 'Для безопасной загрузки используйте PNG, JPEG или WebP.'; error.hidden = false; field('logoFile').value = ''; return; }
    if (file.size > 500 * 1024) { error.textContent = 'Логотип больше 500 КБ. Сожмите файл или выберите другой.'; error.hidden = false; field('logoFile').value = ''; return; }
    const reader = new FileReader();
    reader.addEventListener('load', () => { field('logo').value = reader.result; error.hidden = true; });
    reader.readAsDataURL(file);
  });
  render();
})();
