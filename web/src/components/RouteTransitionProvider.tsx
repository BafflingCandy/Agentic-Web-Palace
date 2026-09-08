"use client";

import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
  type Variants
} from "motion/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type RouteTransitionContextValue = {
  startRouteTransition: (href: string, label?: string) => void;
};

const RouteTransitionContext = createContext<RouteTransitionContextValue | null>(null);

const overlayVariants: Variants = {
  idle: {
    clipPath: "circle(0% at 50% 100%)",
    opacity: 0
  },
  cover: {
    clipPath: "circle(150% at 50% 100%)",
    opacity: 1,
    transition: {
      clipPath: { duration: 0.62, ease: [0.76, 0, 0.24, 1] },
      opacity: { duration: 0.18, ease: "easeOut" }
    }
  },
  reveal: {
    clipPath: "circle(0% at 50% 0%)",
    opacity: 0,
    transition: {
      clipPath: { duration: 0.72, ease: [0.76, 0, 0.24, 1] },
      opacity: { delay: 0.48, duration: 0.2, ease: "easeOut" }
    }
  }
};

export function RouteTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [transitionState, setTransitionState] = useState<"idle" | "cover" | "reveal">("idle");
  const [routeLabel, setRouteLabel] = useState("Next section");
  const pendingHref = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTransitionTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const startRouteTransition = useCallback(
    (href: string, label = "Next section") => {
      if (href === pathname || href.startsWith("#")) {
        router.push(href);
        return;
      }

      clearTransitionTimeout();
      pendingHref.current = href;
      setRouteLabel(label);

      if (reduceMotion) {
        router.push(href);
        return;
      }

      setTransitionState("cover");
      timeoutRef.current = setTimeout(() => {
        router.push(href);
      }, 440);
    },
    [pathname, reduceMotion, router]
  );

  useEffect(() => {
    if (!pendingHref.current) {
      return;
    }

    pendingHref.current = null;
    clearTransitionTimeout();

    if (reduceMotion) {
      setTransitionState("idle");
      return;
    }

    setTransitionState("reveal");
    timeoutRef.current = setTimeout(() => {
      setTransitionState("idle");
    }, 780);
  }, [pathname, reduceMotion]);

  useEffect(() => clearTransitionTimeout, []);

  return (
    <MotionConfig reducedMotion="user">
      <RouteTransitionContext.Provider value={{ startRouteTransition }}>
        {children}
        <AnimatePresence>
          {transitionState !== "idle" ? (
            <motion.div
              className="route-transition-overlay"
              aria-hidden="true"
              initial="idle"
              animate={transitionState}
              exit="idle"
              variants={overlayVariants}
            >
              <motion.div
                className="route-transition-overlay__grid"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.32, ease: "easeOut" }}
              >
                <span>Entering</span>
                <strong>{routeLabel}</strong>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </RouteTransitionContext.Provider>
    </MotionConfig>
  );
}

export function useRouteTransition() {
  const context = useContext(RouteTransitionContext);

  if (!context) {
    throw new Error("useRouteTransition must be used inside RouteTransitionProvider");
  }

  return context;
}
