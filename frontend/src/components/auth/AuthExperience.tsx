import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { animate, utils } from 'animejs';
import { createMotionScope, prefersReducedMotion, pressFeedback } from '@/lib/motion';

const ArchitectureScene = lazy(() => import('./ArchitectureScene')
  .then(({ ArchitectureScene: Scene }) => ({ default: Scene }))
  .catch(() => ({ default: function UnavailableArchitectureScene() { return <></>; } })));

function ArchitecturalFallback() {
  return (
    <svg
      className="login-atmosphere-svg"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="environment-terracotta" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#e03b29" stopOpacity=".35" />
          <stop offset="1" stopColor="#e03b29" stopOpacity=".1" />
        </linearGradient>
        <linearGradient id="environment-navy" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1d5287" stopOpacity=".28" />
          <stop offset="1" stopColor="#091120" stopOpacity=".12" />
        </linearGradient>
        <linearGradient id="environment-gold" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#f6e7a7" stopOpacity=".25" />
          <stop offset=".5" stopColor="#f6e7a7" stopOpacity=".68" />
          <stop offset="1" stopColor="#f6e7a7" stopOpacity=".2" />
        </linearGradient>
      </defs>

      <g className="environment-layer environment-layer-distant">
        <path d="M0 720V486l132-96 137 96v234H0Zm280 0V394h118v-95l175-108 178 108v421H280Zm496 0V455h129V304l192-111 196 112v415H776Zm510 0V389h149v-92l165-95v518h-314Z" fill="url(#environment-gold)" />
        <path d="M112 720V514h56v-55h88v261H112Zm426 0V374h72v-46h91v392H538Zm486 0V367h74v-61h113v414h-187Zm362 0V424h95v-63h110v359h-205Z" fill="url(#environment-navy)" />
      </g>

      <g className="environment-layer environment-layer-middle">
        <path d="M-24 754V618h238v-88h177v224H-24Zm408 0V544h172v-94h181v304H384Zm394 0V624h120v-75h202v205H778Zm458 0V536h190v-89h202v307h-392Z" fill="url(#environment-terracotta)" />
        <path d="m316 618 67-38v174h-67v-136Zm520-7 74-39v182h-74V611Zm548-23 92-53v219h-92V588Z" fill="url(#environment-gold)" opacity=".82" />
      </g>

      <g className="environment-layer environment-layer-near">
        <path d="M0 782h1600v45H0z" fill="#f6e7a7" opacity=".42" />
        <path d="M0 826h1600" fill="none" stroke="#1d5287" strokeOpacity=".2" strokeWidth="1" />
        <path d="M60 755h360m76 0h365m72 0h270m61 0h278" fill="none" stroke="#091120" strokeOpacity=".18" strokeWidth="2" />
      </g>

      <g className="login-atmosphere-linework" fill="none" stroke="#1d5287" strokeOpacity=".18" strokeWidth="1">
        <path d="M170 512V258h196v254M183 512V280m172 232V280M1460 478V208h112v270M1474 478V228m82 250V228" />
        <path d="M0 888h1600M0 905h1600M245 888v-63m390 63v-88m610 88v-63" />
        <path d="m470 241 221-135 226 135M470 251h447M1035 191l170-99 168 99" />
      </g>
    </svg>
  );
}

function LoginEnvironment() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const onReady = useCallback(() => setSceneReady(true), []);
  const onFailure = useCallback(() => {
    setSceneReady(false);
    setSceneFailed(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 767px)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    if (reducedMotion.matches || narrow.matches || coarsePointer.matches) return undefined;

    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="login-atmosphere"
      aria-hidden="true"
      data-scene-ready={sceneReady}
    >
      <ArchitecturalFallback />
      <div className="login-atmosphere-glow" />
      <div className="login-atmosphere-sweep" />
      <div className="login-atmosphere-grain" />
      {shouldLoad && !sceneFailed ? (
        <Suspense fallback={null}>
          <ArchitectureScene onReady={onReady} onFailure={onFailure} />
        </Suspense>
      ) : null}
    </div>
  );
}

export function AuthExperience({ children, interactiveArchitecture = false }: { children: ReactNode; interactiveArchitecture?: boolean }) {
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = pageRef.current;
    const scope = createMotionScope(root);
    if (!root || !scope) return () => scope?.revert();

    scope.add(() => {
      animate('[data-auth-enter]', {
        opacity: [0, 1],
        translateY: [14, 0],
        duration: 720,
        delay: utils.stagger(100, { start: 80 }),
        ease: 'out(3)',
      });
      animate('[data-auth-architecture]', {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 960,
        delay: 260,
        ease: 'out(3)',
      });
      animate('.login-atmosphere', {
        opacity: [0, 1],
        duration: 1500,
        delay: 120,
        ease: 'out(2)',
      });
      animate('.login-atmosphere-linework', {
        opacity: [0, 0.72],
        duration: 1500,
        delay: 150,
        ease: 'out(2)',
      });
    });

    return () => scope.revert();
  }, []);

  function focusFeedback(event: FocusEvent<HTMLElement>) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || prefersReducedMotion()) return;
    animate(field, { scale: [0.995, 1], duration: 220, ease: 'out(3)' });
  }

  function buttonFeedback(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (button instanceof HTMLElement) pressFeedback(button);
  }

  function parallaxFallback(event: PointerEvent<HTMLElement>) {
    const root = pageRef.current;
    if (!root || prefersReducedMotion() || event.pointerType === 'touch') return;
    const x = (event.clientX / window.innerWidth) * 2 - 1;
    const y = (event.clientY / window.innerHeight) * 2 - 1;
    root.style.setProperty('--login-pointer-x', String(x));
    root.style.setProperty('--login-pointer-y', String(y));
  }

  function resetParallax() {
    const root = pageRef.current;
    root?.style.setProperty('--login-pointer-x', '0');
    root?.style.setProperty('--login-pointer-y', '0');
  }

  return (
    <main
      ref={pageRef}
      className="login-experience min-h-screen overflow-x-hidden bg-background px-5 sm:px-8 lg:px-12"
      data-immersive={interactiveArchitecture}
      onFocusCapture={focusFeedback}
      onPointerDownCapture={buttonFeedback}
      onPointerMove={parallaxFallback}
      onPointerLeave={resetParallax}
    >
      {interactiveArchitecture ? <LoginEnvironment /> : null}
      <div className="login-shell mx-auto flex min-h-screen w-full max-w-[1440px] flex-col">
        <header className="login-topbar flex items-center justify-between gap-4 py-5 sm:py-7" data-auth-enter>
          <Link to="/login" className="login-wordmark-link rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="Nivaas sign in">
            <img src="/assets/nivaas-wordmark.png" width="1200" height="400" alt="Nivaas" className="login-wordmark" fetchPriority="high" />
          </Link>
        </header>

        <div className="login-layout grid flex-1 items-center gap-12 pb-10 pt-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,.85fr)] lg:gap-20 lg:pb-16">
          <section className="login-editorial min-w-0" aria-labelledby="login-title">
            <h1 id="login-title" className="login-title max-w-[14ch] font-headline font-bold tracking-[-.055em] text-foreground" data-auth-enter>Governance begins at home.</h1>
            <p className="login-description mt-5 max-w-[38rem] text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8" data-auth-enter>Projects, decisions and society records—brought together in one accountable workspace.</p>

            {interactiveArchitecture ? (
              <div className="login-story-mark mt-7 sm:mt-9" data-auth-enter>
                <img src="/assets/nivaas-mark.png" alt="Nivaas architectural mark" width="1000" height="736" className="login-story-mark-image" decoding="async" />
              </div>
            ) : (
              <div className="login-architecture mt-6 sm:mt-8" data-auth-architecture>
                <img src="/assets/nivaas-mark.png" alt="Nivaas architectural mark" width="1000" height="736" className="login-architecture-mark block h-auto w-full max-w-[31rem]" decoding="async" />
              </div>
            )}
            <ul className="login-values mt-5 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-3" aria-label="Nivaas values" data-auth-enter>
              <li>Transparent decisions</li>
              <li>Organised records</li>
              <li>Stronger communities</li>
            </ul>
          </section>

          {children}
        </div>

        <footer className="login-footer flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-muted-foreground" data-auth-enter>
          <span>Nivaas · Society governance</span>
          <span>Society life, in good order.</span>
        </footer>
      </div>
    </main>
  );
}
