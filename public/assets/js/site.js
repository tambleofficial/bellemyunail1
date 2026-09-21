(() => {
  const menuBtn = document.querySelector("[data-menu-button]");
  const nav = document.querySelector("[data-nav-links]");

  const closeMenu = () => {
    if (!menuBtn || !nav) return;
    nav.classList.remove("open");
    document.body.classList.remove("nav-open");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-label", "메뉴 열기");
    menuBtn.textContent = "Menu";
  };

  if (menuBtn && nav) {
    menuBtn.addEventListener("click", () => {
      const open = !nav.classList.contains("open");
      nav.classList.toggle("open", open);
      document.body.classList.toggle("nav-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
      menuBtn.textContent = open ? "Close" : "Menu";
    });

    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    document.addEventListener("click", (event) => {
      if (!nav.classList.contains("open")) return;
      if (nav.contains(event.target) || menuBtn.contains(event.target)) return;
      closeMenu();
    });

    window.matchMedia("(min-width: 901px)").addEventListener?.("change", (event) => {
      if (event.matches) closeMenu();
    });
  }

  document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const observer = !reduceMotion && "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }), { threshold: .08, rootMargin: "0px 0px 80px" })
    : null;

  document.querySelectorAll(".reveal").forEach((el) => observer ? observer.observe(el) : el.classList.add("is-visible"));

})();
