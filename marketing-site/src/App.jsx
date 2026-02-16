import { useEffect, useState } from "react";

const THEME_KEY = "tcger-theme";
const BASE = import.meta.env.BASE_URL || "/";
const API_DOCS = `${BASE}api/docs/`;
const GH = "https://github.com/ahzs645/TCGer";

function getTheme() {
  if (typeof window === "undefined") return "dark";
  try {
    const s = localStorage.getItem(THEME_KEY);
    if (s === "light" || s === "dark") return s;
  } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#architecture", label: "Stack" },
  { href: "#open-source", label: "Open Source" },
  { href: "#faq", label: "FAQ" },
];

const FEATURES = [
  {
    icon: "search",
    title: "Unified Cross-Game Search",
    desc: "One search bar across Pokemon, Magic, and Yu-Gi-Oh!. Adapter-based architecture with game-specific filters that adapt per TCG.",
  },
  {
    icon: "grid",
    title: "Copy-Level Inventory",
    desc: "Track every copy individually\u2009\u2014\u2009condition, language, serial, acquisition price, current value, tags, notes, and quantity.",
  },
  {
    icon: "book",
    title: "Binder Organization",
    desc: "Named binders with custom colors. An unsorted library for incoming inventory. Move copies between binders as you organize.",
  },
  {
    icon: "bar",
    title: "Dashboard & Analytics",
    desc: "Total cards, estimated value, per-game distribution, and recent activity. Filter by game for focused views.",
  },
  {
    icon: "compass",
    title: "Card Explorer",
    desc: "Dedicated discovery page with advanced filters\u2009\u2014\u2009set, rarity, type. Look up every print and edition of any card.",
  },
  {
    icon: "bolt",
    title: "Performance Caching",
    desc: "Optional local workers for Scryfall, YGO, and TCGdex. Auto-refresh every 12\u201324 hours. Go offline-first without losing data.",
  },
];

const EXTRAS = [
  { label: "API-First", detail: "OpenAPI 3.0 spec with Swagger UI, typed Zod schemas" },
  { label: "Self-Hosted", detail: "Docker Compose deploy, PostgreSQL, optional Redis" },
  { label: "Extensible", detail: "Adapter pattern \u2014 add new TCGs without core changes" },
  { label: "Auth Built-In", detail: "Admin setup flow, JWT sessions, user preferences" },
  { label: "Mobile Soon", detail: "iOS (SwiftUI) and Android (Kotlin) in progress" },
];

const STEPS = [
  {
    title: "Clone & Deploy",
    desc: "Pull the repo, run Docker Compose, and create your admin account through the guided setup flow.",
    code: "git clone https://github.com/ahzs645/TCGer\ncd TCGer && docker compose up",
  },
  {
    title: "Search & Collect",
    desc: "Search cards across all three TCGs. Add copies with condition, price, and language details. Sort them into named binders.",
    code: null,
  },
  {
    title: "Scale & Customize",
    desc: "Enable cache workers for offline speed. Connect mobile clients. Fork and extend with the adapter pattern.",
    code: null,
  },
];

const STACK = [
  { group: "Backend", items: ["Node.js", "Express", "PostgreSQL", "Prisma", "JWT"] },
  { group: "Frontend", items: ["Next.js 14", "React 18", "Tailwind CSS", "Zustand", "React Query"] },
  { group: "Services", items: ["Scryfall Cache", "YGO Cache", "TCGdex Cache", "Docker"] },
  { group: "Shared", items: ["TypeScript", "Zod", "OpenAPI 3.0", "Turborepo"] },
];

const FAQS = [
  { q: "Is TCGer free?", a: "Yes. TCGer is fully open-source and designed to be self-hosted. There are no paid tiers or usage limits." },
  { q: "Which card games are supported?", a: "Pokemon, Magic: The Gathering, and Yu-Gi-Oh! \u2014 all through a unified adapter layer that makes adding new games straightforward." },
  { q: "Do I need the cache services?", a: "No. Cache services are optional accelerators. Start with direct upstream APIs and enable local caching later for offline-first performance." },
  { q: "Is there API documentation?", a: "Yes. TCGer ships with a full OpenAPI 3.0 specification and interactive Swagger UI documentation." },
  { q: "Where can I host this?", a: "Anywhere that runs Docker \u2014 a VPS, a home server, a Raspberry Pi. The only hard requirement is PostgreSQL." },
  { q: "How do I add support for a new TCG?", a: "Implement the card adapter interface for your game\u2019s API. The adapter pattern isolates game-specific logic so the rest of the stack works automatically." },
];

function SvgIcon({ name, size = 22 }) {
  const s = { width: size, height: size };
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: s,
  };
  switch (name) {
    case "search":
      return (<svg {...p}><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>);
    case "grid":
      return (<svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
    case "book":
      return (<svg {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>);
    case "bar":
      return (<svg {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>);
    case "compass":
      return (<svg {...p}><circle cx="12" cy="12" r="10" /><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill="currentColor" stroke="none" /></svg>);
    case "bolt":
      return (<svg {...p}><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" /></svg>);
    case "sun":
      return (<svg {...p}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>);
    case "moon":
      return (<svg {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>);
    default:
      return null;
  }
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  useEffect(() => {
    const fn = () => setStuck(window.scrollY > 20);
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    const fn = () => { if (window.innerWidth > 900) setMenuOpen(false); };
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("visible"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            obs.unobserve(e.target);
          }
        }),
      { threshold: 0.12 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <div className="bg-grain" aria-hidden="true" />
      <div className="bg-orb orb-1" aria-hidden="true" />
      <div className="bg-orb orb-2" aria-hidden="true" />

      <header className={`header${stuck ? " stuck" : ""}`}>
        <a className="logo" href="#top">
          <span className="logo-mark">
            <img src={`${BASE}logo.svg`} alt="" />
          </span>
          <span className="logo-text">TCGer</span>
        </a>

        <button
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-label="Menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span />
          <span />
        </button>

        <nav className={`nav${menuOpen ? " open" : ""}`}>
          {NAV.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
              {l.label}
            </a>
          ))}
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <SvgIcon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
          <a className="btn btn-sm btn-outline" href={GH} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="hero" id="top">
          <div className="hero-content reveal">
            <span className="badge">Open-Source TCG Platform</span>
            <h1>
              Every card. Every game.
              <br />
              <span className="holo-text">One vault.</span>
            </h1>
            <p className="hero-sub">
              Self-hosted collection management for Pokemon, Magic: The Gathering, and
              Yu-Gi-Oh!&thinsp;&mdash;&thinsp;with unified search, per-copy inventory tracking,
              and optional offline caching.
            </p>
            <div className="hero-btns">
              <a className="btn btn-holo" href={GH} target="_blank" rel="noreferrer">
                Get Started
              </a>
              <a className="btn btn-glass" href={API_DOCS}>
                API Docs
              </a>
            </div>
          </div>

          <div className="hero-visual reveal" style={{ transitionDelay: "120ms" }}>
            <div className="dash-card">
              <div className="dash-inner">
                <div className="dash-bar-top">
                  <div className="dash-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="dash-title">Dashboard</span>
                </div>
                <div className="dash-body">
                  <div className="dash-stats">
                    <div className="dash-stat">
                      <span className="dash-val">2,847</span>
                      <span className="dash-lbl">Total Cards</span>
                    </div>
                    <div className="dash-stat">
                      <span className="dash-val">$12.4k</span>
                      <span className="dash-lbl">Est. Value</span>
                    </div>
                    <div className="dash-stat">
                      <span className="dash-val">14</span>
                      <span className="dash-lbl">Binders</span>
                    </div>
                  </div>
                  <div className="dash-games">
                    <div className="dash-game">
                      <span className="dash-dot pkmn" />
                      <span>Pokemon</span>
                      <div className="dash-progress">
                        <div className="dash-fill pkmn-fill" style={{ width: "62%" }} />
                      </div>
                      <span className="dash-num">1,765</span>
                    </div>
                    <div className="dash-game">
                      <span className="dash-dot mtg" />
                      <span>Magic</span>
                      <div className="dash-progress">
                        <div className="dash-fill mtg-fill" style={{ width: "28%" }} />
                      </div>
                      <span className="dash-num">796</span>
                    </div>
                    <div className="dash-game">
                      <span className="dash-dot ygo" />
                      <span>Yu-Gi-Oh!</span>
                      <div className="dash-progress">
                        <div className="dash-fill ygo-fill" style={{ width: "10%" }} />
                      </div>
                      <span className="dash-num">286</span>
                    </div>
                  </div>
                  <div className="dash-recent">
                    <span className="dash-recent-hd">Recent Activity</span>
                    <div className="dash-recent-row">
                      <span className="dash-dot pkmn" />
                      Charizard VMAX added to &quot;Favorites&quot;
                    </div>
                    <div className="dash-recent-row">
                      <span className="dash-dot mtg" />
                      Black Lotus price updated &mdash; $8,200
                    </div>
                    <div className="dash-recent-row">
                      <span className="dash-dot ygo" />
                      Dark Magician moved to &quot;Classics&quot;
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Supported Games */}
        <section className="games reveal">
          <div className="game-card pkmn-card">
            <span className="game-name">Pokemon</span>
            <span className="game-src">TCGdex + Official API</span>
          </div>
          <div className="game-card mtg-card">
            <span className="game-name">Magic: The Gathering</span>
            <span className="game-src">Scryfall Adapter</span>
          </div>
          <div className="game-card ygo-card">
            <span className="game-name">Yu-Gi-Oh!</span>
            <span className="game-src">YGOPRODeck API</span>
          </div>
        </section>

        {/* Features */}
        <section className="section" id="features">
          <div className="section-hd reveal">
            <span className="label">Core Features</span>
            <h2>Built for collectors who manage multiple TCGs.</h2>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f, i) => (
              <article
                key={f.title}
                className="f-card reveal"
                style={{ transitionDelay: `${i * 50}ms` }}
              >
                <div className="f-icon">
                  <SvgIcon name={f.icon} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </article>
            ))}
          </div>
          <div className="extras reveal">
            {EXTRAS.map((e) => (
              <div key={e.label} className="extra">
                <span className="extra-label">{e.label}</span>
                <span className="extra-detail">{e.detail}</span>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="section" id="how-it-works">
          <div className="section-hd reveal">
            <span className="label">How It Works</span>
            <h2>From zero to organized collection in minutes.</h2>
          </div>
          <div className="steps-grid">
            {STEPS.map((s, i) => (
              <div
                key={s.title}
                className="step reveal"
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                <span className="step-n">{`0${i + 1}`}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                {s.code && (
                  <pre className="step-code">
                    <code>{s.code}</code>
                  </pre>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section className="section" id="architecture">
          <div className="section-hd reveal">
            <span className="label">Architecture</span>
            <h2>Designed for extensibility and self-hosting.</h2>
          </div>
          <div className="stack-grid reveal">
            {STACK.map((g) => (
              <div key={g.group} className="stack-group">
                <span className="stack-label">{g.group}</span>
                <div className="stack-pills">
                  {g.items.map((it) => (
                    <span key={it} className="stack-pill">
                      {it}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Open Source */}
        <section className="section" id="open-source">
          <div className="section-hd reveal">
            <span className="label">Open Source</span>
            <h2>Fork it. Self-host it. Make it yours.</h2>
          </div>
          <div className="oss-grid reveal">
            <div className="oss-card">
              <h3>Fully Open Source</h3>
              <p>
                Every line of code lives on GitHub. Fork the repo, run it on your
                infrastructure, and adapt TCGer to your workflow.
              </p>
            </div>
            <div className="oss-card">
              <h3>Own Your Data</h3>
              <p>
                PostgreSQL on your machine. Optional Redis. No third-party services required.
                Your collection data stays under your control.
              </p>
            </div>
            <div className="oss-card">
              <h3>Built to Extend</h3>
              <p>
                Adapter pattern for adding new TCGs. OpenAPI docs and typed interfaces make
                contributions and integrations straightforward.
              </p>
            </div>
          </div>
          <div className="oss-btns reveal">
            <a className="btn btn-holo" href={GH} target="_blank" rel="noreferrer">
              View Repository
            </a>
            <a
              className="btn btn-glass"
              href={`${GH}/issues/new/choose`}
              target="_blank"
              rel="noreferrer"
            >
              Report an Issue
            </a>
          </div>
        </section>

        {/* FAQ */}
        <section className="section" id="faq">
          <div className="section-hd reveal">
            <span className="label">FAQ</span>
            <h2>Common questions.</h2>
          </div>
          <div className="faq-list reveal">
            {FAQS.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="cta reveal">
          <h2>
            Start managing your collection
            <br />
            <span className="holo-text">the right way.</span>
          </h2>
          <p>Clone, deploy, organize. Open source, forever free.</p>
          <div className="cta-btns">
            <a className="btn btn-holo btn-lg" href={GH} target="_blank" rel="noreferrer">
              Clone Repository
            </a>
            <a className="btn btn-glass btn-lg" href={API_DOCS}>
              Explore API
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-top">
          <div className="footer-brand">
            <img src={`${BASE}logo.svg`} alt="" />
            <span>TCGer</span>
          </div>
          <p>Open-source multi-game collection management.</p>
        </div>
        <div className="footer-links">
          <a href={GH} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={API_DOCS}>API Docs</a>
          <a
            href={`${GH}/blob/main/docs/architecture.md`}
            target="_blank"
            rel="noreferrer"
          >
            Architecture
          </a>
        </div>
      </footer>
    </>
  );
}
