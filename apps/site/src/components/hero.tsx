import { LandingVisibleDesktopWindow } from "@/components/landing-visible-desktop-window";
import { SiteGradientBackground } from "@/components/site-gradient-background";
import { SpiritDownloadButton } from "@/components/spirit-download-button";
import { useI18n } from "@/i18n/provider";
import { useHeroShowsDesignModeWindow } from "@/lib/hero-desktop-variant";
import {
  HERO_DESKTOP_WINDOW_FRAME_CLASS,
  LANDING_DESKTOP_WINDOW_VIEWPORT_CLASS,
  SITE_FRAME_CLASS,
} from "@/lib/site-layout";
import { SpiritDesktopWindow } from "./spirit-desktop-window";
import { FONT_WEIGHT_MEDIUM } from "@/lib/typography";

export function Hero() {
  const { messages } = useI18n();
  const heroShowsDesignModeWindow = useHeroShowsDesignModeWindow();

  return (
    <section
      id="site-hero"
      className="relative min-h-dvh w-full bg-background"
      aria-label={messages.hero.sectionAria}
    >
      <div className="relative z-10 flex justify-center pt-48">
        <div className={`${SITE_FRAME_CLASS} @container flex flex-col gap-18`}>
          <div className="w-full space-y-5 text-left">
            <h1
              id="site-hero-title"
              className={`text-[2.75rem] leading-[1.01] ${FONT_WEIGHT_MEDIUM} tracking-[-0.045em] text-foreground sm:text-[3.5rem]`}
            >
              {messages.hero.headline.split("\n").map((line, index) => (
                <span key={index} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="text-pretty text-[1.05rem] leading-snug text-foreground/74 sm:max-w-[50%] sm:text-[1.2rem]">
              {messages.hero.tagline}
            </p>
            <div>
              <SpiritDownloadButton
                downloadVariant="platform"
                className="h-10 gap-1.5 px-5 text-[15px]"
                iconClassName="size-3.5"
              />
            </div>
          </div>
          <div
            className={`relative overflow-hidden rounded-[4px] bg-background ${HERO_DESKTOP_WINDOW_FRAME_CLASS}`}
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <SiteGradientBackground className="absolute inset-0 block h-full w-full" />
            </div>
            <div className="relative z-10 flex h-full min-h-0 flex-col p-5 sm:p-6">
              {heroShowsDesignModeWindow ? (
                <LandingVisibleDesktopWindow
                  demoVariant="designMode"
                  initialWorkspaceToolsOpen
                  initialSessionKey="design"
                  useTranslucency
                  heroBaseTone
                  className="relative z-10 min-h-0 w-full max-w-none flex-1"
                  viewportClassName="flex h-full min-h-0 flex-1 flex-col"
                />
              ) : (
                <SpiritDesktopWindow
                  className="relative z-10 min-h-0 w-full max-w-none flex-1"
                  viewportClassName={LANDING_DESKTOP_WINDOW_VIEWPORT_CLASS}
                  useTranslucency
                  heroBaseTone
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
