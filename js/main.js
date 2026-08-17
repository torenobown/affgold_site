/** Общая логика сайта: меню, вкладки, анимации и активная навигация. */
document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('.nav');

  /**
   * Мобильный drawer.
   * Разметка создаётся из уже существующей навигации, поэтому относительные
   * ссылки остаются корректными на страницах любой вложенности.
   */
  const mobileDock = document.querySelector('.mobile-dock');
  const mobileMenuTrigger = mobileDock?.querySelector('a[href="#footer"]');

  if (mobileMenuTrigger && nav) {
    const backdrop = document.createElement('div');
    const drawer = document.createElement('aside');
    const headerLogo = document.querySelector('.header .logo');
    const homeLink = mobileDock.querySelector('[data-page-link="home"]');

    backdrop.className = 'mobile-menu-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    drawer.className = 'mobile-side-menu';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('aria-label', 'Мобильное меню');

    const drawerHead = document.createElement('div');
    drawerHead.className = 'mobile-side-menu__head';

    const brand = document.createElement('div');
    brand.className = 'mobile-side-menu__brand';
    if (headerLogo) {
      const badge = headerLogo.querySelector('.logo-badge')?.cloneNode(true);
      if (badge) brand.append(badge);
    }
    brand.append(document.createTextNode('AFFGOLD'));

    const closeButton = document.createElement('button');
    closeButton.className = 'mobile-side-menu__close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Закрыть меню');
    closeButton.textContent = '×';

    drawerHead.append(brand, closeButton);

    const drawerNav = document.createElement('nav');
    drawerNav.className = 'mobile-side-menu__nav';

    if (homeLink) {
      const clonedHome = homeLink.cloneNode(true);
      clonedHome.innerHTML = '<span>Главная</span>';
      drawerNav.append(clonedHome);
    }

    nav.querySelectorAll('a').forEach((link) => {
      const clonedLink = link.cloneNode(true);
      drawerNav.append(clonedLink);
    });

    const note = document.createElement('div');
    note.className = 'mobile-side-menu__note';
    note.textContent = '18+. Перед переходом проверяйте актуальные условия выбранного проекта.';

    drawer.append(drawerHead, drawerNav, note);
    document.body.append(backdrop, drawer);

    mobileMenuTrigger.setAttribute('role', 'button');
    mobileMenuTrigger.setAttribute('aria-haspopup', 'dialog');
    mobileMenuTrigger.setAttribute('aria-expanded', 'false');

    const setDrawerState = (open) => {
      backdrop.classList.toggle('is-open', open);
      drawer.classList.toggle('is-open', open);
      document.body.classList.toggle('mobile-menu-open', open);
      mobileMenuTrigger.setAttribute('aria-expanded', String(open));
      backdrop.setAttribute('aria-hidden', String(!open));
      drawer.setAttribute('aria-hidden', String(!open));

      if (open) {
        requestAnimationFrame(() => closeButton.focus());
      } else if (document.activeElement === closeButton) {
        mobileMenuTrigger.focus();
      }
    };

    mobileMenuTrigger.addEventListener('click', (event) => {
      event.preventDefault();
      setDrawerState(!drawer.classList.contains('is-open'));
    });

    closeButton.addEventListener('click', () => setDrawerState(false));
    backdrop.addEventListener('click', () => setDrawerState(false));
    drawerNav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setDrawerState(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawer.classList.contains('is-open')) {
        setDrawerState(false);
      }
    });
  }

  /** Кастомные выпадающие списки с поддержкой клавиатуры. */
  const customSelects = [...document.querySelectorAll('.select-wrap select')];

  const closeCustomSelects = (except = null) => {
    document.querySelectorAll('.custom-select.open').forEach((select) => {
      if (select === except) return;
      select.classList.remove('open');
      select.closest('.catalog-toolbar')?.classList.remove('select-is-open');
      select.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
    });
  };

  customSelects.forEach((nativeSelect, selectIndex) => {
    const customSelect = document.createElement('div');
    const trigger = document.createElement('button');
    const menu = document.createElement('div');
    const listboxId = `custom-select-${selectIndex}`;

    customSelect.className = 'custom-select';
    trigger.className = 'custom-select-trigger';
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', listboxId);
    menu.className = 'custom-select-menu';
    menu.id = listboxId;
    menu.setAttribute('role', 'listbox');

    [...nativeSelect.options].forEach((option, optionIndex) => {
      const item = document.createElement('button');
      item.className = 'custom-select-option';
      item.type = 'button';
      item.dataset.value = option.value;
      item.dataset.index = String(optionIndex);
      item.textContent = option.textContent;
      item.setAttribute('role', 'option');
      menu.append(item);
    });

    nativeSelect.classList.add('custom-select-native');
    nativeSelect.closest('.select-wrap')?.classList.add('custom-select-ready');
    nativeSelect.after(customSelect);
    customSelect.append(trigger, menu);

    const items = [...menu.querySelectorAll('.custom-select-option')];
    const sync = () => {
      const selected = nativeSelect.options[nativeSelect.selectedIndex] || nativeSelect.options[0];
      trigger.innerHTML = `<span></span><i aria-hidden="true"></i>`;
      trigger.querySelector('span').textContent = selected?.textContent || '';
      items.forEach((item) => {
        const active = item.dataset.value === nativeSelect.value;
        item.classList.toggle('selected', active);
        item.setAttribute('aria-selected', String(active));
      });
    };

    const choose = (item) => {
      nativeSelect.value = item.dataset.value;
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      closeCustomSelects();
      trigger.focus();
    };

    trigger.addEventListener('click', () => {
      const willOpen = !customSelect.classList.contains('open');
      closeCustomSelects(customSelect);
      customSelect.classList.toggle('open', willOpen);
      customSelect.closest('.catalog-toolbar')?.classList.toggle('select-is-open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) (menu.querySelector('.selected') || items[0])?.focus();
    });

    menu.addEventListener('click', (event) => {
      const item = event.target.closest('.custom-select-option');
      if (item) choose(item);
    });

    customSelect.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') { closeCustomSelects(); trigger.focus(); return; }
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.custom-select-option')) {
        choose(event.target); return;
      }
      if (!customSelect.classList.contains('open')) { trigger.click(); return; }
      const current = Math.max(0, items.indexOf(document.activeElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowUp' ? Math.max(0, current - 1) : Math.min(items.length - 1, current + 1);
      items[next]?.focus();
    });

    nativeSelect.addEventListener('change', sync);
    nativeSelect._syncCustomSelect = sync;
    sync();
  });

  window.syncCustomSelects = () => customSelects.forEach((select) => select._syncCustomSelect?.());

  menuToggle?.addEventListener('click', () => {
    const open = nav?.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(Boolean(open)));
  });

  document.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy-code]');
    if (copyButton) {
      const code = copyButton.dataset.copyCode;
      const copy = navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(code)
        : Promise.reject(new Error('Clipboard API unavailable'));
      copy.catch(() => {
        const area = document.createElement('textarea');
        area.value = code;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }).finally(() => {
        copyButton.classList.add('copied');
        const label = copyButton.querySelector('span');
        if (!label) return;
        const old = label.textContent;
        label.textContent = 'Скопировано';
        setTimeout(() => { label.textContent = old; copyButton.classList.remove('copied'); }, 1400);
      });
      return;
    }
    if (!event.target.closest('.custom-select')) closeCustomSelects();
    if (!nav?.classList.contains('open') || event.target.closest('.nav') || event.target.closest('[data-menu-toggle]')) return;
    nav.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab-target]');
    if (!button) return;

    const shell = button.closest('.review-tabs-shell') || document;
    const target = button.dataset.tabTarget;

    shell.querySelectorAll('[data-tab-target]').forEach((item) => item.classList.remove('active'));
    shell.querySelectorAll('[data-tab-panel]').forEach((panel) => panel.classList.remove('active'));

    button.classList.add('active');
    shell.querySelector(`[data-tab-panel="${target}"]`)?.classList.add('active');
  });

  const autoRevealSelectors = [
    'main .section-header',
    'main .seo-grid > *',
    'main .project-grid > *',
    'main .stats-grid > *',
    'main .seo-main > .card',
    'main .seo-main > .seo-notice',
    'main .seo-facts > *',
    'main .catalog-toolbar',
    'main .catalog-summary'
  ];
  document.querySelectorAll(autoRevealSelectors.join(','))
    .forEach((element) => { if (!element.classList.contains('no-reveal')) element.classList.add('reveal'); });

  ['.stats-grid', '.project-grid', '.seo-grid', '.seo-facts'].forEach((selector) => {
    document.querySelectorAll(selector).forEach((group) => {
      [...group.children].filter((item) => item.classList.contains('reveal')).forEach((item, index) => {
        item.style.setProperty('--reveal-delay', `${Math.min(index * 55, 165)}ms`);
      });
    });
  });

  const revealElements = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });

    revealElements.forEach((element) => observer.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add('visible'));
  }

  const currentPage = document.body.dataset.page;
  document.querySelectorAll(`[data-page-link="${currentPage}"]`).forEach((link) => link.classList.add('active'));

  document.querySelectorAll('[data-count]').forEach((element) => {
    const target = Number(element.dataset.count) || 0;
    const suffix = element.dataset.suffix || '';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.textContent = `${target}${suffix}`;
      return;
    }
    const start = performance.now();
    const animate = (time) => {
      const progress = Math.min(1, (time - start) / 700);
      element.textContent = `${Math.round(target * progress)}${suffix}`;
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  });
});
