(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Header / scroll progress
  const header = $('[data-header]');
  const onScroll = () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 14);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
    document.documentElement.style.setProperty('--scroll-progress', `${p}%`);
  };
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  // Mobile nav
  const menuBtn = $('[data-menu-button]');
  const nav = $('[data-nav-links]');
  const closeMenu = () => {
    if (!menuBtn || !nav) return;
    nav.classList.remove('open');
    document.body.classList.remove('nav-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    $('.menu-label', menuBtn).textContent = '메뉴';
  };
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => {
      const open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      document.body.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      $('.menu-label', menuBtn).textContent = open ? '닫기' : '메뉴';
    });
    nav.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    document.addEventListener('click', e => {
      if (!nav.classList.contains('open')) return;
      if (nav.contains(e.target) || menuBtn.contains(e.target)) return;
      closeMenu();
    });
  }

  $$('[data-year]').forEach(el => el.textContent = new Date().getFullYear());

  // Scroll reveals
  if (!reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    }), { threshold: .08, rootMargin: '0px 0px -3% 0px' });
    $$('.reveal').forEach(el => io.observe(el));
  } else $$('.reveal').forEach(el => el.classList.add('is-visible'));

  // Homepage horizontal slider
  const slider = $('[data-slider]');
  $('[data-slider-prev]')?.addEventListener('click', () => slider?.scrollBy({ left: -(slider.clientWidth * .72), behavior: 'smooth' }));
  $('[data-slider-next]')?.addEventListener('click', () => slider?.scrollBy({ left: slider.clientWidth * .72, behavior: 'smooth' }));

  // Filterable galleries
  $$('.filter-bar').forEach(bar => {
    const grid = bar.parentElement?.querySelector('[data-filter-grid]');
    if (!grid) return;
    const items = $$('[data-category]', grid);
    $$('[data-filter]', bar).forEach(btn => btn.addEventListener('click', () => {
      const value = btn.dataset.filter;
      $$('[data-filter]', bar).forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      items.forEach(item => {
        const cats = (item.dataset.category || '').split(/\s+/);
        const show = value === 'all' || cats.includes(value);
        item.classList.toggle('is-filtered-out', !show);
      });
    }));
  });

  // Process tabs
  const process = $('[data-process-tabs]');
  if (process) {
    const steps = [
      { kicker:'1단계', title:'좋아하는 분위기부터 이야기해요.', text:'참고 이미지가 있다면 보여주세요. 컬러, 질감, 파츠처럼 공통으로 마음에 드는 요소를 찾아 현재 손에 어울리도록 방향을 잡습니다.', img:'/assets/images/nail-02.webp', alt:'네일 취향 상담 이미지' },
      { kicker:'2단계', title:'현재 손톱에 맞는 쉐입을 찾습니다.', text:'길이와 손톱 상태를 확인하고 디자인이 가장 안정적으로 보이는 쉐입을 정돈합니다. 무리하게 길이를 맞추기보다 전체 비율을 봅니다.', img:'/assets/images/nail-04.webp', alt:'누드 네일 쉐입 이미지' },
      { kicker:'3단계', title:'컬러와 포인트의 강도를 맞춰요.', text:'선택한 무드를 바탕으로 컬러 농도와 아트의 위치를 조정합니다. 같은 디자인도 포인트의 수와 크기에 따라 인상이 달라집니다.', img:'/assets/images/nail-05.webp', alt:'실버 아트 네일 이미지' },
      { kicker:'4단계', title:'마지막 디테일까지 확인합니다.', text:'표면, 라인, 전체 균형을 확인하고 마무리합니다. 유지에 필요한 기본적인 주의사항도 함께 안내합니다.', img:'/assets/images/nail-08.webp', alt:'완성된 네일 디자인 이미지' }
    ];
    const image = $('[data-process-image]', process), kicker = $('[data-process-kicker]', process), title = $('[data-process-title]', process), text = $('[data-process-text]', process), current = $('[data-process-current]', process);
    $$('[data-step]', process).forEach(btn => btn.addEventListener('click', () => {
      const i = Number(btn.dataset.step || 0), step = steps[i];
      $$('[data-step]', process).forEach(b => { const on=b===btn; b.classList.toggle('is-active',on); b.setAttribute('aria-selected',String(on)); });
      if (!step) return;
      if (image) { image.style.opacity='.2'; setTimeout(() => { image.src=step.img; image.alt=step.alt; image.style.opacity='1'; }, 120); }
      if (kicker) kicker.textContent=step.kicker;
      if (title) title.textContent=step.title;
      if (text) text.textContent=step.text;
      if (current) current.textContent=String(i+1).padStart(2,'0');
    }));
  }

  // FAQ: one open at a time
  $$('.faq-item').forEach(item => item.addEventListener('toggle', () => {
    if (!item.open) return;
    $$('.faq-item').forEach(other => { if (other !== item) other.open = false; });
  }));

  // Accessible image lightbox
  const lightboxButtons = $$('[data-lightbox-src]');
  if (lightboxButtons.length) {
    const dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.innerHTML = '<div class="lightbox-wrap"><button class="lightbox-close" type="button" aria-label="닫기">×</button><img alt=""><p class="lightbox-caption"></p></div>';
    document.body.appendChild(dialog);
    const img = $('img', dialog), caption = $('.lightbox-caption', dialog);
    const close = () => dialog.open && dialog.close();
    $('.lightbox-close', dialog).addEventListener('click', close);
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    lightboxButtons.forEach(btn => btn.addEventListener('click', () => {
      img.src = btn.dataset.lightboxSrc || '';
      img.alt = btn.dataset.lightboxAlt || '네일 디자인 확대 이미지';
      caption.textContent = btn.dataset.lightboxAlt || '';
      dialog.showModal();
    }));
  }
})();
