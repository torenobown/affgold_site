/** Общая логика сайта: меню, вкладки, анимации и активная навигация. */
document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('.nav');
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

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
    const siteShell = document.querySelector('.site-shell');
    const headerLogo = document.querySelector('.header .logo');
    const homeLink = mobileDock.querySelector('[data-page-link="home"]');

    backdrop.className = 'mobile-menu-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    drawer.className = 'mobile-side-menu';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('aria-label', 'Мобильное меню');
    drawer.inert = true;

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

    drawer.append(drawerHead, drawerNav);
    document.body.append(backdrop, drawer);

    mobileMenuTrigger.setAttribute('role', 'button');
    mobileMenuTrigger.setAttribute('aria-haspopup', 'dialog');
    mobileMenuTrigger.setAttribute('aria-expanded', 'false');

    const setDrawerState = (open) => {
      const wasOpen = drawer.classList.contains('is-open');
      backdrop.classList.toggle('is-open', open);
      drawer.classList.toggle('is-open', open);
      document.body.classList.toggle('mobile-menu-open', open);
      mobileMenuTrigger.setAttribute('aria-expanded', String(open));
      backdrop.setAttribute('aria-hidden', String(!open));
      drawer.setAttribute('aria-hidden', String(!open));
      drawer.inert = !open;
      if (siteShell) siteShell.inert = open;

      if (open) {
        requestAnimationFrame(() => closeButton.focus());
      } else if (wasOpen) {
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
        return;
      }
      if (event.key !== 'Tab' || !drawer.classList.contains('is-open')) return;
      const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

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
    if (!nav?.classList.contains('open') || event.target.closest('.nav') || event.target.closest('[data-menu-toggle]')) return;
    nav.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  });

  const autoRevealSelectors = [
    'main .section-header',
    'main .seo-grid > *',
    'main .project-grid > *',
    'main .stats-grid > *',
    'main .seo-main > .card',
    'main .catalog-toolbar',
    'main .catalog-summary'
  ];
  document.querySelectorAll(autoRevealSelectors.join(','))
    .forEach((element) => {
      if (element.classList.contains('no-reveal') || element.classList.contains('reveal')) return;
      const bounds = element.getBoundingClientRect();
      const isAlreadyVisible = bounds.bottom > 0 && bounds.top < window.innerHeight * 0.95;
      element.classList.add('reveal');
      if (isAlreadyVisible) element.classList.add('visible');
    });

  ['.stats-grid', '.project-grid', '.seo-grid'].forEach((selector) => {
    document.querySelectorAll(selector).forEach((group) => {
      [...group.children].filter((item) => item.classList.contains('reveal')).forEach((item, index) => {
        item.style.setProperty('--reveal-delay', `${Math.min(index * 55, 165)}ms`);
      });
    });
  });

  const revealElements = document.querySelectorAll('.reveal');
  if (reducedMotionQuery.matches) {
    revealElements.forEach((element) => element.classList.add('visible'));
    document.documentElement.classList.remove('motion-ready');
  } else if ('IntersectionObserver' in window) {
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
    document.documentElement.classList.remove('motion-ready');
  }
  clearTimeout(window.__affgoldMotionFallback);

  const currentPage = document.body.dataset.page;
  document.querySelectorAll(`[data-page-link="${currentPage}"]`).forEach((link) => link.classList.add('active'));

  document.querySelectorAll('[data-count]').forEach((element) => {
    const target = Number(element.dataset.count) || 0;
    const suffix = element.dataset.suffix || '';
    if (reducedMotionQuery.matches) {
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
