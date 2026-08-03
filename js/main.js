document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('.nav');
  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => nav.classList.toggle('open'));
  }

  const tabs = document.querySelectorAll('[data-tab-target]');
  const panels = document.querySelectorAll('[data-tab-panel]');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tabTarget;
      tabs.forEach(item => item.classList.remove('active'));
      panels.forEach(panel => panel.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`[data-tab-panel="${id}"]`)?.classList.add('active');
    });
  });

  const chips = document.querySelectorAll('[data-chip-group] .chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const parent = chip.closest('[data-chip-group]');
      parent?.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(el => observer.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('visible'));
  }

  const current = document.body.dataset.page;
  if (current) {
    document.querySelectorAll(`[data-page-link="${current}"]`).forEach(el => el.classList.add('active'));
  }

  const counters = document.querySelectorAll('[data-count]');
  const animateCounter = (el) => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    let currentVal = 0;
    const step = Math.max(1, Math.round(target / 40));
    const tick = () => {
      currentVal += step;
      if (currentVal >= target) currentVal = target;
      el.textContent = currentVal + suffix;
      if (currentVal < target) requestAnimationFrame(tick);
    };
    tick();
  };
  if ('IntersectionObserver' in window && counters.length) {
    const counterObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(counter => counterObserver.observe(counter));
  }
});
