import { useEffect, useState } from "react";

const THEME_KEY = "tcger-marketing-theme";
const API_DOCS_HREF = "https://github.com/ahzs645/TCGer/blob/main/docs/api.md";
const OPENAPI_SPEC_HREF = "https://github.com/ahzs645/TCGer/blob/main/docs/openapi.yaml";

function getInitialTheme() {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // Ignore storage access issues and fall back to system preference.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "How it works" },
  { href: "#open-source", label: "Open Source" },
  { href: "#faq", label: "FAQ" }
];

const FEATURES = [
  {
    title: "Unified Card Discovery",
    body: "Search cards across all supported games through one adapter-based API."
  },
  {
    title: "Copy-Level Inventory",
    body: "Track language, condition, notes, purchase price, serials, and tags for each copy."
  },
  {
    title: "Binder Structure",
    body: "Organize collections into binders and keep an unsorted library for incoming inventory."
  },
  {
    title: "Auth + Setup Guard",
    body: "First-run admin setup flow, JWT sessions, and account preference management built in."
  },
  {
    title: "Performance Caches",
    body: "Plug in local Scryfall, YGO, and TCGdex cache services to reduce upstream request cost."
  },
  {
    title: "API-First Surface",
    body: "OpenAPI-backed docs, typed routes, and clean separation between web, mobile, and backend."
  }
];

const WORKFLOW_STEPS = [
  {
    title: "Deploy in minutes",
    body: "Start with Docker and create your admin account from the setup route."
  },
  {
    title: "Import and organize",
    body: "Add cards to binders, attach tags, and manage copy-specific details that matter when trading."
  },
  {
    title: "Expand with services",
    body: "Enable cache workers and connect mobile and web clients to one backend source of truth."
  }
];

const OPEN_SOURCE_PILLARS = [
  {
    title: "Truly Open Source",
    body: "Source code lives on GitHub, ready to fork, self-host, and adapt to your own collection workflows."
  },
  {
    title: "Own Your Data",
    body: "Run everything on your own infrastructure with PostgreSQL and optional local cache workers."
  },
  {
    title: "Build in Public",
    body: "OpenAPI docs, typed interfaces, and a clear architecture make contributions and integrations straightforward."
  }
];

const FAQS = [
  {
    question: "Is TCGer free and open source?",
    answer: "Yes. TCGer is an open-source project and designed to be self-hosted."
  },
  {
    question: "Which games are supported right now?",
    answer: "Pokemon, Magic: The Gathering, and Yu-Gi-Oh! are all available through the adapter layer."
  },
  {
    question: "Can I run this without optional cache services?",
    answer:
      "Yes. Cache services are optional accelerators. You can start with direct upstream APIs and enable caches later."
  },
  {
    question: "Is there API documentation for integration?",
    answer: "Yes. OpenAPI and docs references are included in this project and linked from the page."
  }
];

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerStuck, setHeaderStuck] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage access issues.
    }
  }, [theme]);

  useEffect(() => {
    const onScroll = () => {
      setHeaderStuck(window.scrollY > 10);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 820) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll(".reveal"));

    if (!("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );

    nodes.forEach((node, index) => {
      node.style.transitionDelay = `${Math.min(index * 40, 240)}ms`;
      observer.observe(node);
    });

    return () => observer.disconnect();
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <div className="page-glow page-glow-left" aria-hidden="true"></div>
      <div className="page-glow page-glow-right" aria-hidden="true"></div>

      <header className={`site-header ${headerStuck ? "is-stuck" : ""}`} id="top">
        <a className="brand" href="#top">
          <span className="brand-mark">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" aria-hidden="true" />
          </span>
          <span className="brand-name">TCGer</span>
        </a>

        <button
          className="menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="site-nav"
          aria-label="Toggle navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span></span>
          <span></span>
        </button>

        <nav id="site-nav" className={`site-nav ${menuOpen ? "open" : ""}`} aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={closeMenu}>
              {link.label}
            </a>
          ))}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <a className="button nav-button" href="https://github.com/ahzs645/TCGer" target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </nav>
      </header>

      <main>
        <section className="hero section reveal">
          <div className="hero-copy">
            <p className="eyebrow">Open Source</p>
            <h1>One command center for every card game you collect.</h1>
            <p className="hero-lead">
              Track Pokemon, Magic, and Yu-Gi-Oh! in one system with unified search, per-copy inventory detail, and
              self-hosted API control.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="https://github.com/ahzs645/TCGer" target="_blank" rel="noreferrer">
                Get started on GitHub
              </a>
              <a
                className="button button-secondary"
                href={API_DOCS_HREF}
              >
                Explore API docs
              </a>
            </div>
            <ul className="hero-points">
              <li>Open-source codebase with clear docs and architecture notes.</li>
              <li>Cross-game search, binders, and copy-level tracking.</li>
              <li>Optional local cache services to reduce external API load.</li>
            </ul>
          </div>

          <aside className="hero-panel" aria-label="Product snapshot">
            <div className="hero-panel-header">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
            <div className="hero-panel-body">
              <h2>Collection Pulse</h2>
              <p>Across all enabled games</p>
              <div className="metric-grid">
                <article>
                  <h3>3</h3>
                  <p>TCGs synced</p>
                </article>
                <article>
                  <h3>1</h3>
                  <p>Unified search</p>
                </article>
                <article>
                  <h3>100%</h3>
                  <p>Self-hostable</p>
                </article>
                <article>
                  <h3>4</h3>
                  <p>Cache workers</p>
                </article>
              </div>
              <div className="hero-panel-strip">
                <span className="chip">Pokemon</span>
                <span className="chip">Magic</span>
                <span className="chip">Yu-Gi-Oh!</span>
              </div>
            </div>
          </aside>
        </section>

        <section className="marquee section reveal">
          <p>Built in public for collectors who do not want to split workflows across game-specific apps.</p>
        </section>

        <section className="section reveal" id="features">
          <div className="section-intro">
            <p className="eyebrow">Core Features</p>
            <h2>Everything a modern TCG ops stack needs.</h2>
          </div>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="feature-card">
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section reveal" id="workflow">
          <div className="section-intro">
            <p className="eyebrow">How It Works</p>
            <h2>Fast setup, then scale as your inventory grows.</h2>
          </div>
          <ol className="steps">
            {WORKFLOW_STEPS.map((step, index) => (
              <li key={step.title} className="step">
                <span className="step-number">{`0${index + 1}`}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="section reveal" id="open-source">
          <div className="section-intro">
            <p className="eyebrow">Open Source</p>
            <h2>Use it, fork it, and shape the roadmap with us.</h2>
          </div>
          <div className="open-source-grid">
            {OPEN_SOURCE_PILLARS.map((pillar) => (
              <article key={pillar.title} className="open-source-card">
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
              </article>
            ))}
          </div>
          <div className="hero-actions">
            <a className="button button-primary" href="https://github.com/ahzs645/TCGer" target="_blank" rel="noreferrer">
              View repository
            </a>
            <a
              className="button button-secondary"
              href="https://github.com/ahzs645/TCGer/issues/new/choose"
              target="_blank"
              rel="noreferrer"
            >
              Contribute or report issues
            </a>
          </div>
        </section>

        <section className="section reveal" id="faq">
          <div className="section-intro">
            <p className="eyebrow">FAQ</p>
            <h2>Questions launch teams usually ask.</h2>
          </div>
          <div className="faq-list">
            {FAQS.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="section reveal cta-block">
          <h2>Build your collection workflow with open source.</h2>
          <p>Fork TCGer, run it locally, and tailor it to your collector or shop operations.</p>
          <div className="hero-actions">
            <a className="button button-primary" href="https://github.com/ahzs645/TCGer" target="_blank" rel="noreferrer">
              Clone repository
            </a>
            <a
              className="button button-secondary"
              href={API_DOCS_HREF}
            >
              Open API docs
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>TCGer - Open-source multi-game collection infrastructure.</p>
        <div className="footer-links">
          <a href="https://github.com/ahzs645/TCGer" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={OPENAPI_SPEC_HREF}>OpenAPI Spec</a>
          <a href="https://github.com/ahzs645/TCGer/blob/main/docs/architecture.md" target="_blank" rel="noreferrer">
            Architecture Notes
          </a>
        </div>
      </footer>
    </>
  );
}
