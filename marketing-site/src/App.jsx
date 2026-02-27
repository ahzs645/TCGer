import { useEffect, useState } from "react";

const THEME_KEY = "tcger-theme";
const BASE = import.meta.env.BASE_URL || "/";
const API_DOCS = `${BASE}api/docs/`;
const PRODUCT_DOCS = `${BASE}docs/`;
const DEMO = `${BASE}demo/`;
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
  { href: "#how-it-works", label: "How it works" },
  { href: "#stack", label: "Stack" },
  { href: "#open-source", label: "Open source" },
  { href: "#faq", label: "FAQ" },
];

const GAMES = [
  { name: "Pokemon", src: "TCGdex + Official API", color: "pkmn" },
  { name: "Magic: The Gathering", src: "Scryfall Adapter", color: "mtg" },
  { name: "Yu-Gi-Oh!", src: "YGOPRODeck API", color: "ygo" },
];

const FEATURES = [
  {
    icon: "search",
    title: "Unified Cross-Game Search",
    desc: "One search bar, three games. Adapter-based architecture serves results with filters that adapt per TCG.",
  },
  {
    icon: "grid",
    title: "Copy-Level Inventory",
    desc: "Track every physical copy\u2009\u2014\u2009condition, language, serial number, price, current value, tags, and notes.",
  },
  {
    icon: "book",
    title: "Binder Organization",
    desc: "Named binders with custom colors. An unsorted library catches incoming cards. Move copies between binders freely.",
  },
  {
    icon: "chart",
    title: "Dashboard & Analytics",
    desc: "Total cards, estimated value, per-game distribution, and a recent activity feed\u2009\u2014\u2009all at a glance.",
  },
  {
    icon: "compass",
    title: "Card Explorer",
    desc: "Dedicated discovery with filters for set, rarity, and type. Every print and edition of any card, across games.",
  },
  {
    icon: "bolt",
    title: "Performance Caching",
    desc: "Optional local workers for Scryfall, YGO, and TCGdex. Auto-refresh every 12\u201324 hours. Offline-first ready.",
  },
];

const EXTRAS = [
  "API-First \u00b7 OpenAPI 3.0 + Swagger UI",
  "Self-Hosted \u00b7 Docker Compose + PostgreSQL",
  "Extensible \u00b7 Adapter pattern for new TCGs",
  "Auth Built-In \u00b7 JWT + admin setup flow",
  "Mobile Coming \u00b7 iOS SwiftUI + Android Kotlin",
];

const STEPS = [
  {
    title: "Clone & Deploy",
    desc: "Pull the repo, start everything with Docker Compose. First-run setup creates your admin account.",
    code: "git clone github.com/ahzs645/TCGer\ncd TCGer && docker compose up",
  },
  {
    title: "Search & Collect",
    desc: "Search across Pokemon, Magic, and Yu-Gi-Oh! at once. Add copies with full detail\u2009\u2014\u2009condition, price, language, tags.",
    code: null,
  },
  {
    title: "Scale & Extend",
    desc: "Enable cache workers for offline speed. Connect mobile apps. Add new TCGs through the adapter interface.",
    code: null,
  },
];

const STACK = [
  { group: "Backend", items: ["Node.js", "Express", "PostgreSQL", "Prisma", "JWT"] },
  { group: "Frontend", items: ["Next.js 14", "React 18", "Tailwind", "Zustand", "React Query"] },
  { group: "Cache Services", items: ["Scryfall", "YGO", "TCGdex", "Docker"] },
  { group: "Shared Layer", items: ["TypeScript", "Zod", "OpenAPI 3.0", "Turborepo"] },
];

const OSS = [
  { title: "Fully open source", desc: "Every line on GitHub. Fork it, self-host it, adapt it. No hidden services, no vendor lock-in." },
  { title: "Own your data", desc: "PostgreSQL on your machine. Optional Redis. No third-party services required. Your collection stays yours." },
  { title: "Built to extend", desc: "Adapter pattern for new TCGs. OpenAPI spec and typed interfaces make contributions straightforward." },
];

const FAQS = [
  { q: "Is TCGer free?", a: "Yes. Fully open-source and self-hosted. No paid tiers, no usage limits." },
  { q: "Which card games?", a: "Pokemon, Magic: The Gathering, and Yu-Gi-Oh!\u2009\u2014\u2009all through a unified adapter layer." },
  { q: "Do I need the cache services?", a: "No. They\u2019re optional accelerators. Start with direct APIs and add caching later." },
  { q: "API documentation?", a: "Full OpenAPI 3.0 spec with interactive Swagger UI included." },
  { q: "Where can I host it?", a: "Anywhere with Docker\u2009\u2014\u2009VPS, home server, Raspberry Pi. Just needs PostgreSQL." },
  { q: "Adding a new TCG?", a: "Implement the adapter interface. The pattern isolates game logic so the rest of the stack works automatically." },
];

function Icon({ name, size = 22 }) {
  const p = {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
    style: { width: size, height: size },
  };
  const icons = {
    search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
    compass: <><circle cx="12" cy="12" r="10" /><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill="currentColor" stroke="none" /></>,
    bolt: <><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" /></>,
    sun: <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>,
    moon: <><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></>,
  };
  return <svg {...p}>{icons[name]}</svg>;
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
    const els = document.querySelectorAll(".rv");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("vis"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("vis");
            obs.unobserve(e.target);
          }
        }),
      { threshold: 0.1, rootMargin: "0px 0px -30px 0px" }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {/* ── Header ── */}
      <header className={`hdr${stuck ? " stuck" : ""}`}>
        <a className="logo" href="#top">
          <span className="logo-icon"><img src={`${BASE}logo.svg`} alt="" /></span>
          <span className="logo-name">TCGer</span>
        </a>
        <button className="hamburger" aria-expanded={menuOpen} aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          <span /><span />
        </button>
        <nav className={`nav${menuOpen ? " open" : ""}`}>
          {NAV.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>{l.label}</a>
          ))}
          <div className="nav-end">
            <button className="theme-btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} aria-label="Toggle theme">
              <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
            </button>
            <a className="btn btn-sm btn-ghost" href={GH} target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="hero" id="top">
          <div className="hero-text rv">
            <div className="pill"><span className="pill-dot" />Open-Source Collection Platform</div>
            <h1>Your cards <em>deserve</em> better than spreadsheets.</h1>
            <p className="hero-sub">
              TCGer is a self-hosted platform for managing Pokemon, Magic:&nbsp;The&nbsp;Gathering,
              and Yu-Gi-Oh! collections&thinsp;&mdash;&thinsp;unified search, per-copy inventory,
              binder organization, and optional offline caching.
            </p>
            <div className="hero-btns">
              <a className="btn btn-warm" href={GH} target="_blank" rel="noreferrer">Get Started</a>
              <a className="btn btn-ghost" href={DEMO}>Live Demo</a>
              <a className="btn btn-ghost" href={PRODUCT_DOCS}>Docs</a>
            </div>
          </div>
          <div className="hero-visual rv" style={{ transitionDelay: "180ms" }}>
            <div className="cards-scene">
              <div className="glow glow-pkmn" />
              <div className="glow glow-mtg" />
              <div className="glow glow-ygo" />
              <img src={`${BASE}Pokemon_Back.png`} alt="Pokemon card back" className="tcard tcard-pkmn" />
              <img src={`${BASE}MTG_Back.png`} alt="Magic: The Gathering card back" className="tcard tcard-mtg" />
              <img src={`${BASE}Yugioh_Back.png`} alt="Yu-Gi-Oh! card back" className="tcard tcard-ygo" />
            </div>
          </div>
        </section>

        {/* ── Games ── */}
        <section className="games rv">
          {GAMES.map((g) => (
            <div key={g.name} className={`gpanel gp-${g.color}`}>
              <div className="gpanel-bar" />
              <div>
                <span className="gpanel-name">{g.name}</span>
                <span className="gpanel-src">{g.src}</span>
              </div>
            </div>
          ))}
        </section>

        {/* ── Features ── */}
        <section className="sec" id="features">
          <div className="sec-hd rv">
            <div className="sec-tag"><span className="pill-dot" />Core Features</div>
            <h2>Everything a serious collector needs.</h2>
          </div>
          <div className="feat-grid">
            {FEATURES.map((f, i) => (
              <article key={f.title} className="fcard rv" style={{ transitionDelay: `${i * 55}ms` }}>
                <div className="fcard-icon"><Icon name={f.icon} /></div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </article>
            ))}
          </div>
          <div className="extras rv">
            {EXTRAS.map((e) => (
              <span key={e} className="ext-pill">{e}</span>
            ))}
          </div>
        </section>

        {/* ── How It Works ── */}
        <section className="sec" id="how-it-works">
          <div className="sec-hd rv">
            <div className="sec-tag"><span className="pill-dot" />How It Works</div>
            <h2>From zero to organized in minutes.</h2>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s.title} className="scard rv" style={{ transitionDelay: `${i * 70}ms` }}>
                <span className="scard-num">{`0${i + 1}`}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                {s.code && <pre className="scard-code"><code>{s.code}</code></pre>}
              </div>
            ))}
          </div>
        </section>

        {/* ── Architecture ── */}
        <section className="sec" id="stack">
          <div className="sec-hd rv">
            <div className="sec-tag"><span className="pill-dot" />Architecture</div>
            <h2>Built for extensibility and self-hosting.</h2>
          </div>
          <div className="stk rv">
            {STACK.map((g) => (
              <div key={g.group} className="stk-group">
                <span className="stk-label">{g.group}</span>
                <div className="stk-pills">
                  {g.items.map((it) => (
                    <span key={it} className="stk-pill">{it}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Open Source ── */}
        <section className="sec" id="open-source">
          <div className="sec-hd rv">
            <div className="sec-tag"><span className="pill-dot" />Open Source</div>
            <h2>Fork it. Host it. Make it yours.</h2>
          </div>
          <div className="oss-grid">
            {OSS.map((o, i) => (
              <div key={o.title} className="oss-card rv" style={{ transitionDelay: `${i * 55}ms` }}>
                <h3>{o.title}</h3>
                <p>{o.desc}</p>
              </div>
            ))}
          </div>
          <div className="oss-btns rv">
            <a className="btn btn-warm" href={GH} target="_blank" rel="noreferrer">View Repository</a>
            <a className="btn btn-ghost" href={`${GH}/issues/new/choose`} target="_blank" rel="noreferrer">Report an Issue</a>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="sec" id="faq">
          <div className="sec-hd rv">
            <div className="sec-tag"><span className="pill-dot" />FAQ</div>
            <h2>Common questions.</h2>
          </div>
          <div className="faq-list rv">
            {FAQS.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="cta rv">
          <div className="cta-glow" />
          <h2>Start building your collection<br />the right way.</h2>
          <p>Clone, deploy, organize. Open source, forever free.</p>
          <div className="cta-btns">
            <a className="btn btn-warm btn-lg" href={GH} target="_blank" rel="noreferrer">Clone Repository</a>
            <a className="btn btn-ghost btn-lg" href={API_DOCS}>Explore API</a>
          </div>
        </section>
      </main>

      <footer className="ftr">
        <div className="ftr-left">
          <div className="ftr-brand">
            <img src={`${BASE}logo.svg`} alt="" />
            <span>TCGer</span>
          </div>
          <p>Open-source multi-game collection management.</p>
        </div>
        <div className="ftr-links">
          <a href={GH} target="_blank" rel="noreferrer">GitHub</a>
          <a href={API_DOCS}>API Docs</a>
          <a href={`${PRODUCT_DOCS}reference/architecture/`}>Architecture</a>
        </div>
      </footer>
    </>
  );
}
