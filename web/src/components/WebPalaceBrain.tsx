"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Menu, Search, X } from "lucide-react";
import {
  brainTraceEdges,
  brainTraceNodes,
  brainTraceViewBox
} from "@/data/brainTrace";
import { webPalaces, type WebPalaceEntry } from "@/data/webPalaces";
import { filterWebPalaces, groupWebPalacesAlphabetically } from "@/lib/webPalaceSearch";
import { useRouteTransition } from "./RouteTransitionProvider";
import { WebPalaceIntro, type WebPalaceIntroPhase } from "./WebPalaceIntro";
import { AddWebPalaceNode } from "./AddWebPalaceNode";

type Particle = {
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  intensity: number;
  phase: number;
  driftPhase: number;
  driftSpeed: number;
  driftRadius: number;
  waveWeight: number;
};

type PointerState = {
  active: boolean;
  x: number;
  y: number;
};

const pointerReach = 14;
const maxDisplacement = 4.2;
const websiteHoverRadius = 6.8;
const websiteHoverReleaseRadius = 10.5;
const canvasRenderPadding = 24;
const websiteNodeIndexes = new Set(webPalaces.map((palace) => palace.traceNode));

function ordinalDay(day: number) {
  const lastTwoDigits = day % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${day}th`;
  }

  const suffix = day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  return `${day}${suffix}`;
}

function formatLocalTime(date: Date) {
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);

  return `${ordinalDay(date.getDate())} ${month} ${date.getFullYear()}, ${time}`;
}

function nodeDistanceToPointer(node: Particle, pointer: PointerState) {
  if (!pointer.active) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(node.x - pointer.x, node.y - pointer.y);
}

function mapClientToTrace(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  const drawableWidth = Math.max(1, rect.width - canvasRenderPadding * 2);
  const drawableHeight = Math.max(1, rect.height - canvasRenderPadding * 2);
  const scale = Math.min(drawableWidth / brainTraceViewBox.width, drawableHeight / brainTraceViewBox.height);
  const offsetX = (rect.width - brainTraceViewBox.width * scale) / 2;
  const offsetY = (rect.height - brainTraceViewBox.height * scale) / 2;

  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale
  };
}

function buildParticles(): Particle[] {
  const edgeCounts = Array.from({ length: brainTraceNodes.length }, () => 0);

  brainTraceEdges.forEach(([from, to]) => {
    edgeCounts[from] += 1;
    edgeCounts[to] += 1;
  });

  return brainTraceNodes.map(([x, y, radius, intensity], index) => ({
    anchorX: x,
    anchorY: y,
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    intensity,
    phase: (index * 1.618) % Math.PI,
    driftPhase: (index * 2.399963) % (Math.PI * 2),
    driftSpeed: 0.00052 + ((index * 37) % 100) * 0.0000028,
    driftRadius: edgeCounts[index] <= 4 ? 1.25 : edgeCounts[index] <= 6 ? 0.92 : 0.58,
    waveWeight: edgeCounts[index] <= 4 ? 1 : edgeCounts[index] <= 6 ? 0.54 : 0.22
  }));
}

function getPalaceAnchorDistance(palace: WebPalaceEntry, pointer: PointerState, particles: Particle[]) {
  if (!pointer.active) {
    return Number.POSITIVE_INFINITY;
  }

  const node = particles[palace.traceNode];

  if (!node) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(node.anchorX - pointer.x, node.anchorY - pointer.y);
}

export function WebPalaceBrain({
  canAddNodes = false,
  skipIntro = false
}: {
  canAddNodes?: boolean;
  skipIntro?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const { startRouteTransition } = useRouteTransition();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>(buildParticles());
  const pointerRef = useRef<PointerState>({ active: false, x: 50, y: 43 });
  const clickablePalaceRef = useRef<WebPalaceEntry | null>(null);
  const navigationStartedRef = useRef(false);
  const frameRef = useRef(0);
  const indexTriggerRef = useRef<HTMLButtonElement | null>(null);
  const indexCloseRef = useRef<HTMLButtonElement | null>(null);
  const indexDrawerRef = useRef<HTMLElement | null>(null);
  const wasIndexOpenRef = useRef(false);
  const [activePalace, setActivePalace] = useState<WebPalaceEntry | null>(null);
  const [showIntro, setShowIntro] = useState(!skipIntro);
  const [introPhase, setIntroPhase] = useState<WebPalaceIntroPhase>(skipIntro ? "brain-in" : "waiting");
  const [introReady, setIntroReady] = useState(false);
  const [localTime, setLocalTime] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [indexOpen, setIndexOpen] = useState(false);

  const palaceNodes = useMemo(() => {
    return webPalaces.map((palace) => ({
      palace,
      particle: particlesRef.current[palace.traceNode]
    }));
  }, []);

  const filteredPalaces = useMemo(() => {
    return filterWebPalaces(webPalaces, searchQuery);
  }, [searchQuery]);

  const alphabetizedPalaces = useMemo(() => {
    return groupWebPalacesAlphabetically(filteredPalaces);
  }, [filteredPalaces]);

  useEffect(() => {
    if (!showIntro) {
      return;
    }

    if (!introReady) {
      return;
    }

    setIntroPhase("text-in");

    const animationInTimer = window.setTimeout(() => setIntroPhase("animation-in"), 1100);
    const textOutTimer = window.setTimeout(() => setIntroPhase("text-out"), 3300);
    const animationOutTimer = window.setTimeout(() => setIntroPhase("animation-out"), 4450);
    const brainInTimer = window.setTimeout(() => setIntroPhase("brain-in"), 6100);
    const removeTimer = window.setTimeout(() => setShowIntro(false), 8600);

    return () => {
      window.clearTimeout(animationInTimer);
      window.clearTimeout(textOutTimer);
      window.clearTimeout(animationOutTimer);
      window.clearTimeout(brainInTimer);
      window.clearTimeout(removeTimer);
    };
  }, [introReady, reduceMotion, showIntro]);

  const handleIntroReady = useCallback(() => {
    setIntroReady(true);
  }, []);

  useEffect(() => {
    const updateTime = () => setLocalTime(new Date());
    updateTime();

    const interval = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (indexOpen) {
      wasIndexOpenRef.current = true;
      const focusTimer = window.setTimeout(() => indexCloseRef.current?.focus(), 80);
      return () => window.clearTimeout(focusTimer);
    }

    if (wasIndexOpenRef.current) {
      wasIndexOpenRef.current = false;
      const focusTimer = window.setTimeout(() => indexTriggerRef.current?.focus(), 80);
      return () => window.clearTimeout(focusTimer);
    }
  }, [indexOpen]);

  useEffect(() => {
    if (!indexOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIndexOpen(false);
        return;
      }

      if (event.key === "Tab") {
        const focusableElements = Array.from(
          indexDrawerRef.current?.querySelectorAll<HTMLButtonElement>('button:not([tabindex="-1"])') ?? []
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements.at(-1);

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [indexOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const drawableWidth = Math.max(1, width - canvasRenderPadding * 2);
      const drawableHeight = Math.max(1, height - canvasRenderPadding * 2);
      scale = Math.min(drawableWidth / brainTraceViewBox.width, drawableHeight / brainTraceViewBox.height);
      offsetX = (width - brainTraceViewBox.width * scale) / 2;
      offsetY = (height - brainTraceViewBox.height * scale) / 2;
    };

    const toCanvasX = (x: number) => offsetX + x * scale;
    const toCanvasY = (y: number) => offsetY + y * scale;

    const updateParticles = (time: number) => {
      const pointer = pointerRef.current;
      const motionScale = reduceMotion ? 0.28 : 1;

      particlesRef.current.forEach((node, index) => {
        const breath = Math.sin(time * 0.00034 + node.anchorX * 0.09) * 0.32;
        const waveX =
          Math.sin(time * 0.00072 + node.phase * 2.7 + node.anchorY * 0.03) *
          (0.22 + node.waveWeight * 0.74) *
          motionScale;
        const waveY =
          Math.cos(time * 0.00058 + node.phase * 2.1 + node.anchorX * 0.025) *
          (0.16 + node.waveWeight * 0.52) *
          motionScale;
        const centerPullX = (node.anchorX - brainTraceViewBox.width / 2) * 0.006 * breath * node.waveWeight * motionScale;
        const centerPullY = (node.anchorY - brainTraceViewBox.height / 2) * 0.005 * breath * node.waveWeight * motionScale;
        const driftTime = time * node.driftSpeed + node.driftPhase;
        const driftX =
          Math.sin(driftTime) *
          node.driftRadius *
          (0.72 + node.waveWeight * 0.34) *
          motionScale;
        const driftY =
          Math.cos(driftTime * 1.27 + node.phase) *
          node.driftRadius *
          0.76 *
          motionScale;
        const targetX = node.anchorX + waveX + centerPullX + driftX;
        const targetY = node.anchorY + waveY + centerPullY + driftY;
        const springX = (targetX - node.x) * 0.062;
        const springY = (targetY - node.y) * 0.062;
        node.vx += springX;
        node.vy += springY;

        if (pointer.active) {
          const dx = node.x - pointer.x;
          const dy = node.y - pointer.y;
          const distance = Math.max(0.001, Math.hypot(dx, dy));

          if (distance < pointerReach) {
            const force = ((pointerReach - distance) / pointerReach) ** 2;
            const swirl = ((pointerReach - distance) / pointerReach) * 0.13;
            const websiteMotionScale = websiteNodeIndexes.has(index) ? 0.58 : 1;
            node.vx += ((dx / distance) * force * 0.48 + (-dy / distance) * swirl) * websiteMotionScale;
            node.vy += ((dy / distance) * force * 0.48 + (dx / distance) * swirl) * websiteMotionScale;
          }
        }

        node.vx *= 0.86;
        node.vy *= 0.86;
        node.x += node.vx;
        node.y += node.vy;

        const displacementX = node.x - node.anchorX;
        const displacementY = node.y - node.anchorY;
        const displacement = Math.hypot(displacementX, displacementY);

        if (displacement > maxDisplacement) {
          const clamp = maxDisplacement / displacement;
          node.x = node.anchorX + displacementX * clamp;
          node.y = node.anchorY + displacementY * clamp;
          node.vx *= 0.35;
          node.vy *= 0.35;
        }
      });
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      updateParticles(time);

      const particles = particlesRef.current;
      const pointer = pointerRef.current;
      const activeIndex = activePalace?.traceNode ?? -1;

      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowBlur = 0;
      context.shadowColor = "transparent";

      brainTraceEdges.forEach(([from, to], edgeIndex) => {
        const a = particles[from];
        const b = particles[to];
        const nearPointer = Math.min(nodeDistanceToPointer(a, pointer), nodeDistanceToPointer(b, pointer));
        const activeEdge = from === activeIndex || to === activeIndex;
        const proximityLift = pointer.active && nearPointer < pointerReach ? (pointerReach - nearPointer) / pointerReach : 0;
        const linkPulse = Math.max(0, Math.sin(time * 0.0016 + edgeIndex * 0.23)) * (reduceMotion ? 0.008 : 0.028);
        const alpha = Math.min(0.5, 0.075 + linkPulse + proximityLift * 0.18 + (activeEdge ? 0.18 : 0));
        const ax = toCanvasX(a.x);
        const ay = toCanvasY(a.y);
        const bx = toCanvasX(b.x);
        const by = toCanvasY(b.y);

        context.beginPath();

        if (edgeIndex % 5 === 0) {
          const midX = (ax + bx) / 2;
          const midY = (ay + by) / 2;
          const curve = (((edgeIndex * 37) % 100) / 100 - 0.5) * 10;
          context.moveTo(ax, ay);
          context.quadraticCurveTo(midX + curve, midY - curve, bx, by);
        } else {
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
        }

        context.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        context.lineWidth = activeEdge ? 0.72 : 0.48;
        context.stroke();

        const shouldDrawAmbientBead = !reduceMotion && edgeIndex % 47 === 0;

        if (proximityLift > 0.34 || shouldDrawAmbientBead) {
          const beadProgress = (Math.sin(time * 0.0022 + edgeIndex * 0.71) + 1) / 2;
          const beadAlpha = proximityLift > 0.34 ? 0.08 + proximityLift * 0.18 : 0.055;
          context.beginPath();
          context.arc(
            ax + (bx - ax) * beadProgress,
            ay + (by - ay) * beadProgress,
            Math.max(0.55, scale * (proximityLift > 0.34 ? 0.12 : 0.08)),
            0,
            Math.PI * 2
          );
          context.shadowBlur = proximityLift > 0.34 ? 8 : 4;
          context.shadowColor = "rgba(255, 255, 255, 0.34)";
          context.fillStyle = `rgba(255, 255, 255, ${beadAlpha})`;
          context.fill();
          context.shadowBlur = 0;
          context.shadowColor = "transparent";
        }
      });

      particles.forEach((node, index) => {
        const isWebsiteNode = websiteNodeIndexes.has(index);
        const isActivePalace = index === activeIndex;
        const distance = nodeDistanceToPointer(node, pointer);
        const proximityLift = pointer.active && distance < pointerReach ? (pointerReach - distance) / pointerReach : 0;
        const shimmer = Math.sin(time * 0.0014 + node.phase) * (reduceMotion ? 0.018 : 0.062);
        const baseRadius = isWebsiteNode ? node.radius * 0.66 : node.radius * 0.38;
        const radius = (baseRadius + proximityLift * 0.1 + (isActivePalace ? 0.5 : 0)) * scale;
        const baseAlpha = isWebsiteNode ? node.intensity * 0.74 + 0.18 : node.intensity * 0.4 + 0.1;
        const alpha = Math.min(1, baseAlpha + proximityLift * 0.22 + shimmer);
        const x = toCanvasX(node.x);
        const y = toCanvasY(node.y);

        if (isActivePalace) {
          context.beginPath();
          context.arc(x, y, radius + 9, 0, Math.PI * 2);
          context.strokeStyle = "rgba(255, 255, 255, 0.62)";
          context.lineWidth = 1.1;
          context.stroke();
        }

        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.shadowBlur = isWebsiteNode ? 12 : 5;
        context.shadowColor = `rgba(255, 255, 255, ${isWebsiteNode ? 0.42 : 0.2})`;
        context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        context.fill();
        context.shadowBlur = 0;
        context.shadowColor = "transparent";

        if (isWebsiteNode) {
          context.beginPath();
          context.arc(x, y, radius + (isActivePalace ? 2.8 : 1.5), 0, Math.PI * 2);
          context.shadowBlur = isActivePalace ? 16 : 9;
          context.shadowColor = "rgba(255, 255, 255, 0.34)";
          context.fillStyle = `rgba(255, 255, 255, ${isActivePalace ? 0.18 : 0.08})`;
          context.fill();
          context.shadowBlur = 0;
          context.shadowColor = "transparent";
        }
      });

      palaceNodes.forEach(({ palace, particle }) => {
        if (!particle) {
          return;
        }

        const isActive = palace.id === activePalace?.id;

        if (!isActive) {
          return;
        }

        const x = toCanvasX(particle.x);
        const y = toCanvasY(particle.y);

        context.font = `600 ${Math.max(12, scale * 2.1)}px Poppins, sans-serif`;
        context.textBaseline = "middle";
        context.fillStyle = "rgba(255, 255, 255, 0.96)";
        context.fillText(palace.title, x + 16, y - 16);
      });

      frameRef.current = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frameRef.current = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [activePalace?.id, activePalace?.traceNode, palaceNodes, reduceMotion]);

  const updatePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const pointer = mapClientToTrace(canvas, event.clientX, event.clientY);
    pointerRef.current = { active: true, ...pointer };

    const lockedPalace = clickablePalaceRef.current;

    if (lockedPalace) {
      const lockedDistance = getPalaceAnchorDistance(lockedPalace, pointerRef.current, particlesRef.current);

      if (lockedDistance <= websiteHoverReleaseRadius) {
        setActivePalace((current) => (current?.id === lockedPalace.id ? current : lockedPalace));
        return;
      }
    }

    const nearest = webPalaces
      .map((palace) => {
        return {
          palace,
          distance: getPalaceAnchorDistance(palace, pointerRef.current, particlesRef.current)
        };
      })
      .sort((a, b) => a.distance - b.distance)[0];

    if (nearest && nearest.distance < websiteHoverRadius) {
      clickablePalaceRef.current = nearest.palace;
      setActivePalace((current) => (current?.id === nearest.palace.id ? current : nearest.palace));
    } else {
      clickablePalaceRef.current = null;
      setActivePalace((current) => (current === null ? current : null));
    }
  };

  const enterPalace = (palace: WebPalaceEntry) => {
    if (palace.status !== "live" || navigationStartedRef.current) {
      return;
    }

    navigationStartedRef.current = true;

    if (palace.destination.type === "external") {
      window.location.assign(palace.destination.href);
      return;
    }

    startRouteTransition(palace.destination.href, palace.title);
  };

  const resolveClickablePalace = () => {
    const pointer = pointerRef.current;
    const lockedPalace = clickablePalaceRef.current;

    if (lockedPalace && getPalaceAnchorDistance(lockedPalace, pointer, particlesRef.current) <= websiteHoverReleaseRadius) {
      return lockedPalace;
    }

    const nearest = webPalaces
      .map((palace) => ({
        palace,
        distance: getPalaceAnchorDistance(palace, pointer, particlesRef.current)
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return nearest && nearest.distance < websiteHoverRadius ? nearest.palace : activePalace;
  };

  const handleCanvasClick = () => {
    const palace = resolveClickablePalace();

    if (palace) {
      clickablePalaceRef.current = palace;
      enterPalace(palace);
    }
  };

  const previewPalace = (palace: WebPalaceEntry | null) => {
    clickablePalaceRef.current = palace;
    setActivePalace(palace);
  };

  return (
    <main className={`web-palace-main${showIntro && introPhase !== "brain-in" ? " is-intro-active" : ""}`}>
      {showIntro ? <WebPalaceIntro phase={introPhase} onReady={handleIntroReady} /> : null}
      <section className="web-palace-stage" aria-labelledby="web-palace-title">
        <h1 id="web-palace-title" className="sr-only">Web Palace</h1>

        <form className="brain-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <Search aria-hidden="true" size={17} strokeWidth={1.5} />
          <label className="sr-only" htmlFor="palace-search">Search websites</label>
          <input
            id="palace-search"
            type="search"
            placeholder="Search the palace"
            value={searchQuery}
            autoComplete="off"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchQuery("");
                event.currentTarget.blur();
              }
            }}
          />
          {searchQuery ? (
            <button type="button" aria-label="Clear search" onClick={() => setSearchQuery("")}>
              <X aria-hidden="true" size={15} strokeWidth={1.5} />
            </button>
          ) : null}
        </form>

        <div className="brain-field">
          <canvas
            ref={canvasRef}
            className="brain-canvas"
            aria-label="Interactive Web Palace node brain"
            role="img"
            onPointerMove={updatePointer}
            onPointerEnter={updatePointer}
            onPointerDown={handleCanvasClick}
            onPointerLeave={() => {
              pointerRef.current = { active: false, x: 50, y: 43 };
              clickablePalaceRef.current = null;
              setActivePalace(null);
            }}
            onPointerUp={handleCanvasClick}
            onClick={handleCanvasClick}
          />
        </div>

        {activePalace ? (
          <aside className="web-palace-node-card" aria-live="polite">
            <span>{activePalace.cluster}</span>
            <h2>{activePalace.title}</h2>
            <p>{activePalace.summary}</p>
          </aside>
        ) : null}

        <button
          ref={indexTriggerRef}
          className="palace-index-trigger"
          type="button"
          aria-label="Open website index"
          aria-expanded={indexOpen}
          aria-controls="palace-index-drawer"
          onClick={() => setIndexOpen(true)}
        >
          <Menu aria-hidden="true" size={22} strokeWidth={1.4} />
        </button>

        {canAddNodes ? <AddWebPalaceNode /> : null}

        <button
          className={`palace-index-scrim${indexOpen ? " is-open" : ""}`}
          type="button"
          aria-label="Close website index"
          tabIndex={-1}
          onClick={() => setIndexOpen(false)}
        />

        <aside
          ref={indexDrawerRef}
          id="palace-index-drawer"
          className={`palace-index-drawer${indexOpen ? " is-open" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Website index"
          aria-hidden={!indexOpen}
        >
          <header>
            <div>
              <span>Web Palace</span>
              <h2>Index</h2>
            </div>
            <button
              ref={indexCloseRef}
              type="button"
              aria-label="Close website index"
              tabIndex={indexOpen ? 0 : -1}
              onClick={() => setIndexOpen(false)}
            >
              <X aria-hidden="true" size={19} strokeWidth={1.4} />
            </button>
          </header>

          <nav className="palace-alpha-index" aria-label="Websites, alphabetically">
            {alphabetizedPalaces.length ? (
              <div>
                {alphabetizedPalaces.map((group) => (
                  <section key={group.letter} aria-labelledby={`palace-letter-${group.letter}`}>
                    <h3 id={`palace-letter-${group.letter}`}>{group.letter}</h3>
                    <ul>
                      {group.palaces.map((palace) => (
                        <li key={palace.id}>
                          <button
                            type="button"
                            tabIndex={indexOpen ? 0 : -1}
                            className={activePalace?.id === palace.id ? "is-active" : ""}
                            onClick={() => {
                              setIndexOpen(false);
                              enterPalace(palace);
                            }}
                            onFocus={() => previewPalace(palace)}
                            onBlur={() => previewPalace(null)}
                            onPointerEnter={() => previewPalace(palace)}
                            onPointerLeave={() => previewPalace(null)}
                          >
                            {palace.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <p className="palace-alpha-index__empty">Try a title, subject, or tag.</p>
            )}
          </nav>
        </aside>

        {localTime ? (
          <time
            className={`palace-clock${introPhase === "brain-in" ? " is-arriving" : ""}`}
            dateTime={localTime.toISOString()}
          >
            {formatLocalTime(localTime)}
          </time>
        ) : null}
      </section>
    </main>
  );
}
