/**
 * 外壳：单窗口，一个 page 字段切页（§2.2，不引路由库）。
 */
import { useApp, type Page } from "./store.ts";
import { t } from "./i18n.ts";
import { HomePage } from "./pages/HomePage.tsx";
import { ReviewPage } from "./pages/ReviewPage.tsx";
import { RereviewPage } from "./pages/RereviewPage.tsx";
import { TodayPage } from "./pages/TodayPage.tsx";
import { ImportPage } from "./pages/ImportPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

const NAV: Array<{ page: Page; label: string }> = [
  { page: "home", label: t.nav.home },
  { page: "import", label: t.nav.import },
  { page: "search", label: t.nav.search },
  { page: "settings", label: t.nav.settings },
];

export function App() {
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);

  // 复习页全屏，不显示顶部导航（减少干扰）
  if (page === "review") {
    return (
      <div className="h-full">
        <ReviewPage />
      </div>
    );
  }

  // 重新复习同样全屏：它和复习用的是同一种「一屏一张」的形态
  if (page === "rereview") {
    return (
      <div className="h-full">
        <RereviewPage />
      </div>
    );
  }

  // 今日新词也是「一屏一张」，同样全屏
  if (page === "today") {
    return (
      <div className="h-full">
        <TodayPage />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-ink-line/60 px-6 py-2">
        <span className="mr-4 text-sm font-medium tracking-wide text-paper-dim">{t.appName}</span>
        {NAV.map((n) => (
          <button
            key={n.page}
            type="button"
            onClick={() => setPage(n.page)}
            className={
              page === n.page
                ? "relative rounded px-3 py-1.5 text-sm text-paper"
                : "rounded px-3 py-1.5 text-sm text-paper-dim transition-colors hover:text-paper"
            }
          >
            {n.label}
            {page === n.page && (
              <span className="absolute inset-x-2 -bottom-[9px] h-px bg-accent" aria-hidden />
            )}
          </button>
        ))}
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {page === "home" && <HomePage />}
        {page === "import" && <ImportPage />}
        {page === "search" && <SearchPage />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
