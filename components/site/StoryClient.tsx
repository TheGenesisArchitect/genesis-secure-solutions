'use client';
// Five scenes that hold the screen while you scroll (desktop), each moving one idea forward:
// one record -> live setup -> approvals -> three dashboards -> the whole network.
// Smooth scrolling (Lenis) drives GSAP ScrollTrigger. Phones and reduced motion get the same scenes
// stacked, revealed as they enter, with nothing pinned.
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

export type MapData = { land: string; borders: string; dots: { x: number; y: number; live: boolean }[] };

const SCENES = [
  { eyebrow: '01 · One record', title: 'One record becomes everything.', text: 'Who the agent is, where they serve, what they offer and what their carrier allows. Genovus turns it into the website, the profiles, the copy kit and a personal welcome film.' },
  { eyebrow: '02 · Live setup', title: 'Set up live, together.', text: 'A specialist leads and the agent’s screen follows. Facebook, Instagram and Google come alive step by step, on the agent’s own device. No password ever changes hands.' },
  { eyebrow: '03 · Approvals', title: 'Approved before anything goes out.', text: 'Every word is checked against platform limits and carrier rules before a person reads it. The approver signs off, and any later edit comes back for approval.' },
  { eyebrow: '04 · Dashboards', title: 'Three dashboards. One record underneath.', text: 'Our team runs every client from the Enterprise console. Each agency has its own dashboard. Carriers and networks see their whole portfolio. Nobody ever sees what isn’t theirs.' },
  { eyebrow: '05 · The network', title: 'Built for the whole network.', text: 'From one office to every office in a carrier’s network: each one live, on brand and approved, with growth tracked from one view.' },
];

const OUTPUTS = [
  { label: 'Website', sub: 'carrier-aware', dx: -250, dy: -150 },
  { label: 'Facebook Page', sub: 'set up live', dx: 250, dy: -160 },
  { label: 'Instagram', sub: 'professional', dx: 290, dy: 40 },
  { label: 'Google listing', sub: 'claimed', dx: 190, dy: 190 },
  { label: 'Welcome film', sub: 'personal', dx: -230, dy: 170 },
];
const STEPS = ['Facebook Page created', 'Instagram connected', 'Meta partner access', 'Google listing claimed', 'Copy approved'];

export function StoryClient({ map }: { map: MapData }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lenis = reduce ? null : new Lenis({ duration: 1.1, anchors: true });
    const onTick = (t: number) => lenis?.raf(t * 1000);
    if (lenis) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(onTick);
      gsap.ticker.lagSmoothing(0);
    }

    const mm = gsap.matchMedia();
    mm.add({ desktop: '(min-width: 980px) and (prefers-reduced-motion: no-preference)', other: '(max-width: 979px), (prefers-reduced-motion: reduce)' }, (ctx) => {
      const q = gsap.utils.selector(el);
      if (!ctx.conditions?.desktop) {
        // Stacked: reveal each scene as it arrives.
        q('.scene').forEach((s) => gsap.from(s, { autoAlpha: 0, y: 40, duration: 0.8, ease: 'power2.out', scrollTrigger: { trigger: s, start: 'top 80%' } }));
        q('.map-dots').forEach((d) => gsap.set(d, { clipPath: 'inset(0 0% 0 0)' }));
        return;
      }
      const copies = q('.scene-copy');
      const stages = q('.stage');
      gsap.set(copies.slice(1), { autoAlpha: 0, y: 30 });
      gsap.set(stages.slice(1), { autoAlpha: 0 });
      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: { trigger: q('.story-pin')[0], start: 'top top', end: `+=${SCENES.length * 110}%`, pin: true, scrub: 0.8, anticipatePin: 1 },
      });
      // Scene 1: the record, then its outputs fly out along their lines.
      tl.from(q('.record'), { scale: 0.8, autoAlpha: 0, duration: 0.4 })
        .from(q('.out'), { x: 0, y: 0, scale: 0.4, autoAlpha: 0, stagger: 0.08, duration: 0.6 }, '<0.1')
        .from(q('.out-line'), { strokeDashoffset: 400, stagger: 0.08, duration: 0.6 }, '<');
      const step = (i: number) => {
        tl.to(copies[i - 1], { autoAlpha: 0, y: -30, duration: 0.3 }, `s${i}`)
          .to(stages[i - 1], { autoAlpha: 0, duration: 0.3 }, `s${i}`)
          .to(copies[i], { autoAlpha: 1, y: 0, duration: 0.4 }, `s${i}+=0.15`)
          .to(stages[i], { autoAlpha: 1, duration: 0.4 }, `s${i}+=0.1`);
      };
      tl.addLabel('s1', '+=0.6'); step(1);
      tl.from(q('.device'), { rotateY: 28, rotateX: 8, y: 40, duration: 0.6 }, 's1+=0.1')
        .from(q('.tick'), { autoAlpha: 0, x: -14, stagger: 0.12, duration: 0.3 }, '<0.2')
        .fromTo(q('.setup-bar i'), { scaleX: 0 }, { scaleX: 1, duration: 0.8 }, '<');
      tl.addLabel('s2', '+=0.5'); step(2);
      tl.from(q('.draft'), { y: 80, autoAlpha: 0, rotate: (i) => [-6, 3, -2][i] ?? 0, stagger: 0.12, duration: 0.5 }, 's2+=0.15')
        .from(q('.rule'), { autoAlpha: 0, scale: 0.8, stagger: 0.08, duration: 0.3 }, '<0.3')
        .from(q('.stamp'), { scale: 2.4, autoAlpha: 0, rotate: -18, duration: 0.35, ease: 'back.out(2)' }, '>');
      tl.addLabel('s3', '+=0.5'); step(3);
      tl.fromTo(q('.layer'), { x: 0, y: 0, z: 0, rotateY: 0 }, { x: (i) => [-260, 0, 260][i], y: (i) => [40, -20, 40][i], z: (i) => [-120, 60, -120][i], rotateY: (i) => [18, 0, -18][i], duration: 0.9, stagger: 0.05 }, 's3+=0.15');
      tl.addLabel('s4', '+=0.5'); step(4);
      tl.fromTo(q('.map-dots'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1, ease: 'none' }, 's4+=0.2')
        .from(q('.map-live'), { autoAlpha: 0, duration: 0.5 }, '>-0.3');
      tl.to({}, { duration: 0.4 });
    });

    return () => {
      mm.revert();
      if (lenis) {
        gsap.ticker.remove(onTick);
        lenis.destroy();
      }
    };
  }, []);

  return (
    <section ref={root} id="story" className="story" aria-label="How Genovus works">
      <div className="story-pin">
        <div className="story-grid wrapx">
          <div className="story-copy">
            {SCENES.map((s, i) => (
              <div key={s.title} className="scene-copy scene" style={{ order: i * 2 }}>
                <div className="eyebrow">{s.eyebrow}</div>
                <h2 className="big">{s.title}</h2>
                <p className="lede">{s.text}</p>
                <div className="story-progress" aria-hidden="true">{SCENES.map((_, j) => <i key={j} className={j === i ? 'on' : ''} />)}</div>
              </div>
            ))}
          </div>
          <div className="story-stage">
            {/* 1: one record */}
            <div className="stage scene" style={{ order: 1 }}>
              <svg className="out-lines" viewBox="-360 -260 720 520" aria-hidden="true">
                {OUTPUTS.map((o) => <line key={o.label} className="out-line" x1="0" y1="0" x2={o.dx} y2={o.dy} />)}
              </svg>
              <div className="record">
                <div className="eyebrow" style={{ color: 'var(--muted)' }}>Agent record</div>
                <b>Brooks Family Insurance</b>
                <dl><dt>Agent</dt><dd>Avery Brooks</dd><dt>Serves</dt><dd>Riverside &amp; nearby towns</dd><dt>Lines</dt><dd>Auto · Home · Renters</dd><dt>Carrier rules</dt><dd className="ok">Attested ✓</dd></dl>
              </div>
              {OUTPUTS.map((o) => (
                <div key={o.label} className="out" style={{ ['--dx' as string]: `${o.dx}px`, ['--dy' as string]: `${o.dy}px` }}>
                  <b>{o.label}</b><span>{o.sub}</span>
                </div>
              ))}
            </div>
            {/* 2: live setup */}
            <div className="stage scene" style={{ order: 3 }}>
              <div className="device"><img src="/site/stills/s05.jpg" alt="The live setup wizard and the specialist console side by side" loading="lazy" /></div>
              <div className="ticks">
                {STEPS.map((s) => <div key={s} className="tick"><span>✓</span>{s}</div>)}
                <div className="setup-bar"><i /></div>
              </div>
            </div>
            {/* 3: approvals */}
            <div className="stage scene" style={{ order: 5 }}>
              <div className="drafts">
                {['Instagram bio', 'Facebook post · Oct 21', 'Google description'].map((d, i) => (
                  <div key={d} className="draft" style={{ ['--i' as string]: i }}>
                    <span className="muted" style={{ fontSize: 12 }}>{d}</span>
                    <p>{['Your neighborhood agency. Auto · Home · Renters. Hablamos Español.', 'Storm season reminder: photos of your home and car today make any claim easier later.', 'The Riverside office of Avery Brooks, an exclusive agency serving Riverside and nearby towns.'][i]}</p>
                  </div>
                ))}
                <div className="rules"><span className="rule chip done">Within limits</span><span className="rule chip done">No guarantees</span><span className="rule chip done">Carrier wording</span></div>
                <div className="stamp">Approved</div>
              </div>
            </div>
            {/* 4: three dashboards */}
            <div className="stage scene" style={{ order: 7 }}>
              <div className="layers">
                <img className="layer" src="/site/screens/console.png" alt="Enterprise console, sample data" loading="lazy" />
                <img className="layer" src="/site/screens/agency.png" alt="Agency dashboard, sample data" loading="lazy" />
                <img className="layer" src="/site/screens/network.png" alt="Network view, sample data" loading="lazy" />
              </div>
              <div className="layer-names"><span>Enterprise</span><span>Agency</span><span>Network</span></div>
            </div>
            {/* 5: the network */}
            <div className="stage scene" style={{ order: 9 }}>
              <svg className="usmap" viewBox="0 0 975 610" role="img" aria-label="Illustrative map of agency offices across the United States">
                <path d={map.land} className="map-land" />
                <path d={map.borders} className="map-borders" />
                <g className="map-dots">
                  {map.dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.live ? 4.2 : 2.6} className={d.live ? 'dot live' : 'dot'} />)}
                </g>
              </svg>
              <div className="map-live"><span className="chip sample">Illustrative vision</span><span className="muted" style={{ fontSize: 13 }}>Bright: live on Genovus · dim: onboarding</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
