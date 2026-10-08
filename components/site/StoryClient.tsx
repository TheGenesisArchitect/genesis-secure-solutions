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
    // Softer, more natural smooth scrolling; touch keeps the device's own physics.
    const lenis = reduce ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true, anchors: true });
    const onTick = (t: number) => lenis?.raf(t * 1000);
    if (lenis) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(onTick);
      gsap.ticker.lagSmoothing(0);
    }

    const mm = gsap.matchMedia();
    mm.add(
      {
        desktop: '(min-width: 980px) and (prefers-reduced-motion: no-preference)',
        phone: '(max-width: 979px) and (prefers-reduced-motion: no-preference)',
        still: '(prefers-reduced-motion: reduce)',
      },
      (ctx) => {
        const q = gsap.utils.selector(el);
        const c = ctx.conditions ?? {};

        // Hero hand-off: the headline drifts up and fades, the 3D scene recedes, in step with the scroll.
        const hero = document.querySelector('.hero2');
        if (hero && !c.still) {
          gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } })
            .to('.hero2-copy', { y: -80, autoAlpha: 0, ease: 'none' }, 0)
            .to('.hero-visual', { scale: 0.9, autoAlpha: 0.15, ease: 'none' }, 0);
        }
        if (c.still) return;

        if (c.phone) {
          // Every scene and its parts rise and settle in proportion to the scroll: nothing pops.
          const rise = (target: gsap.TweenTarget, trigger: Element, from: gsap.TweenVars, start = 'top 92%', end = 'top 52%') =>
            gsap.fromTo(target, from, { autoAlpha: 1, x: 0, y: 0, scale: 1, rotate: 0, filter: 'blur(0px)', ease: 'none', stagger: 0.12, scrollTrigger: { trigger, start, end, scrub: 0.6 } });
          q('.scene-copy').forEach((s) => rise(s, s, { autoAlpha: 0, y: 50, filter: 'blur(6px)' }));
          q('.stage').forEach((s) => rise(s, s, { autoAlpha: 0, y: 70, scale: 0.94, filter: 'blur(6px)' }));
          rise(q('.out'), q('.record')[0], { autoAlpha: 0, y: 30, scale: 0.9 }, 'top 75%', 'top 35%');
          rise(q('.tick'), q('.ticks')[0], { autoAlpha: 0, x: -20 }, 'top 90%', 'top 55%');
          rise(q('.draft'), q('.drafts')[0], { autoAlpha: 0, y: 40, rotate: -3 }, 'top 90%', 'top 50%');
          gsap.fromTo(q('.stamp'), { autoAlpha: 0, scale: 2 }, { autoAlpha: 1, scale: 1, ease: 'back.out(2)', scrollTrigger: { trigger: q('.drafts')[0], start: 'top 45%', end: 'top 30%', scrub: 0.5 } });
          gsap.fromTo(q('.layer'), { x: 0, rotateY: 0, scale: 0.9 }, {
            x: (i) => ['-16%', '0%', '16%'][i], rotateY: (i) => [14, 0, -14][i], scale: (i) => [0.86, 1, 0.86][i], ease: 'none',
            scrollTrigger: { trigger: q('.layers')[0], start: 'top 85%', end: 'top 40%', scrub: 0.6 },
          });
          gsap.fromTo(q('.map-dots'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', ease: 'none', scrollTrigger: { trigger: q('.usmap')[0], start: 'top 85%', end: 'top 35%', scrub: 0.6 } });
          return;
        }

        // Desktop: one pinned stage; scenes dissolve into each other and the scroll settles on each one.
        const copies = q('.scene-copy');
        const stages = q('.stage');
        gsap.set(copies.slice(1), { autoAlpha: 0, y: 40, filter: 'blur(8px)' });
        gsap.set(stages.slice(1), { autoAlpha: 0, scale: 1.05, filter: 'blur(10px)' });
        const bar = q('.story-bar i')[0];
        const tl = gsap.timeline({
          defaults: { ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: q('.story-pin')[0],
            start: 'top top',
            end: `+=${SCENES.length * 120}%`,
            pin: true,
            scrub: 1,
            anticipatePin: 1,
            onUpdate: (self) => bar && gsap.set(bar, { scaleX: self.progress }),
          },
        });
        tl.addLabel('s0');
        tl.from(q('.record'), { scale: 0.85, autoAlpha: 0, filter: 'blur(8px)', duration: 0.5 })
          .from(q('.out'), { x: 0, y: 0, scale: 0.4, autoAlpha: 0, stagger: 0.07, duration: 0.7, ease: 'power3.out' }, '<0.15')
          .from(q('.out-line'), { strokeDashoffset: 400, stagger: 0.07, duration: 0.7 }, '<');
        // A crossfade where the outgoing scene softens away while the next one sharpens in.
        const step = (i: number) => {
          tl.addLabel(`s${i}`, '+=0.5');
          tl.to(copies[i - 1], { autoAlpha: 0, y: -40, filter: 'blur(8px)', duration: 0.55 }, `s${i}`)
            .to(stages[i - 1], { autoAlpha: 0, scale: 0.95, filter: 'blur(10px)', duration: 0.55 }, `s${i}`)
            .to(copies[i], { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.6 }, `s${i}+=0.25`)
            .to(stages[i], { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.6 }, `s${i}+=0.2`);
        };
        step(1);
        tl.from(q('.device'), { rotateY: 28, rotateX: 8, y: 40, duration: 0.7, ease: 'power3.out' }, 's1+=0.25')
          .from(q('.tick'), { autoAlpha: 0, x: -16, stagger: 0.1, duration: 0.35 }, '<0.2')
          .fromTo(q('.setup-bar i'), { scaleX: 0 }, { scaleX: 1, duration: 0.8 }, '<');
        step(2);
        tl.from(q('.draft'), { y: 80, autoAlpha: 0, rotate: (i) => [-6, 3, -2][i] ?? 0, stagger: 0.1, duration: 0.55, ease: 'power3.out' }, 's2+=0.25')
          .from(q('.rule'), { autoAlpha: 0, scale: 0.8, stagger: 0.07, duration: 0.3 }, '<0.3')
          .from(q('.stamp'), { scale: 2.4, autoAlpha: 0, rotate: -18, duration: 0.4, ease: 'back.out(2)' }, '>');
        step(3);
        tl.fromTo(q('.layer'), { x: 0, y: 0, z: 0, rotateY: 0 }, { x: (i) => [-170, 0, 200][i], y: (i) => [44, -20, 44][i], z: (i) => [-160, 60, -160][i], rotateY: (i) => [18, 0, -18][i], duration: 1, stagger: 0.05, ease: 'power3.out' }, 's3+=0.25');
        step(4);
        tl.fromTo(q('.map-dots'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.1, ease: 'none' }, 's4+=0.3')
          .from(q('.map-live'), { autoAlpha: 0, y: 10, duration: 0.5 }, '>-0.3');
        tl.addLabel('end', '+=0.3');
      },
    );

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
            <div className="story-bar" aria-hidden="true"><i /></div>
            {SCENES.map((s, i) => (
              <div key={s.title} className="scene-copy scene" style={{ order: i * 2 }}>
                <div className="eyebrow">{s.eyebrow}</div>
                <h2 className="big">{s.title}</h2>
                <p className="lede">{s.text}</p>
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
