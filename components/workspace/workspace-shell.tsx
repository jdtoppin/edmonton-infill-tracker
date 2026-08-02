"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Map,
  Menu,
  ShieldCheck,
  UserRound,
  X,
  type LucideProps,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AuthenticatedUser } from "@/src/lib/auth";
import { Brand } from "./brand";
import { LogoutButton } from "./logout-button";

export type WorkspaceUser = Pick<AuthenticatedUser, "email" | "name" | "role">;

export type WorkspaceShellProps = {
  children: ReactNode;
  user: WorkspaceUser;
  authenticated?: boolean;
};

type NavigationItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: ComponentType<LucideProps>;
  adminOnly?: boolean;
};

const navigationItems: readonly NavigationItem[] = [
  {
    href: "/",
    label: "Overview",
    shortLabel: "Overview",
    icon: LayoutDashboard,
  },
  {
    href: "/projects",
    label: "Explore projects",
    shortLabel: "Explore",
    icon: Map,
  },
  {
    href: "/admin",
    label: "Administration",
    shortLabel: "Admin",
    icon: ShieldCheck,
    adminOnly: true,
  },
];

function routeIsActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function displayName(user: WorkspaceUser): string {
  const name = user.name?.trim();
  return name || user.email;
}

function initials(user: WorkspaceUser): string {
  const source = user.name?.trim() || user.email.split("@")[0] || "User";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}

function NavigationLink({
  item,
  pathname,
  mobile = false,
  onNavigate,
}: {
  item: NavigationItem;
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const active = routeIsActive(pathname, item.href);
  const Icon = item.icon;

  if (mobile) {
    return (
      <Link
        href={item.href}
        className={cn("drawer-link", active && "active")}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
      >
        <Icon size={19} aria-hidden="true" />
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn("nav-item", active && "active")}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

export function WorkspaceShell({ children, user, authenticated = true }: WorkspaceShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const availableNavigation = useMemo(
    () => navigationItems.filter((item) => !item.adminOnly || user.role === "ADMIN"),
    [user.role],
  );

  useEffect(() => {
    if (!menuOpen) {
      if (wasOpenRef.current) menuButtonRef.current?.focus();
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const drawer = drawerRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      drawer ? Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    const animationFrame = window.requestAnimationFrame(() => {
      (focusable()[0] ?? drawer)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        drawer?.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 981px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) closeMenu();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [closeMenu]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-label">Workspace</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {availableNavigation
            .filter((item) => !item.adminOnly)
            .map((item) => (
              <NavigationLink item={item} pathname={pathname} key={item.href} />
            ))}
        </nav>

        {user.role === "ADMIN" && (
          <>
            <div className="sidebar-label admin-label">Administration</div>
            <nav className="sidebar-nav" aria-label="Administration navigation">
              {availableNavigation
                .filter((item) => item.adminOnly)
                .map((item) => (
                  <NavigationLink item={item} pathname={pathname} key={item.href} />
                ))}
            </nav>
          </>
        )}

        <section className="mt-auto border-t border-white/10 pt-4" aria-label="Signed-in account">
          <div className="mb-3 grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 px-2">
            <div className="grid size-[34px] place-items-center rounded-full bg-[#dce8e5] text-[10px] font-extrabold text-[var(--spruce)]">
              {initials(user)}
            </div>
            <div className="flex min-w-0 flex-col">
              <strong className="truncate text-xs font-semibold text-white">
                {displayName(user)}
              </strong>
              <span className="mt-0.5 truncate text-[11px] text-[#8fa4a3]">
                {!authenticated
                  ? "Preview mode"
                  : user.role === "ADMIN"
                    ? "Administrator"
                    : "Member"}
              </span>
            </div>
          </div>
          {authenticated && <LogoutButton tone="dark" />}
        </section>
      </aside>

      <header className="mobile-header">
        <Brand />
        <button
          type="button"
          ref={menuButtonRef}
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls="workspace-navigation-drawer"
          onClick={() => setMenuOpen(true)}
          className="inline-flex size-10 items-center justify-center rounded-lg text-white transition-colors outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--spruce)]"
        >
          <Menu size={21} aria-hidden="true" />
        </button>
      </header>

      {menuOpen && (
        <div className="mobile-drawer">
          <button
            type="button"
            className="drawer-backdrop cursor-default border-0"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={closeMenu}
          />
          <div
            id="workspace-navigation-drawer"
            ref={drawerRef}
            className="drawer-panel flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
          >
            <div className="drawer-head">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                onClick={closeMenu}
                aria-label="Close navigation menu"
              >
                <X size={20} aria-hidden="true" />
              </Button>
            </div>

            <nav aria-label="Mobile navigation">
              {availableNavigation.map((item) => (
                <NavigationLink
                  item={item}
                  pathname={pathname}
                  mobile
                  onNavigate={closeMenu}
                  key={item.href}
                />
              ))}
            </nav>

            <section
              className="mt-auto rounded-xl border border-[var(--border)] bg-[#f7f7f3] p-3"
              aria-label="Signed-in account"
            >
              <div className="mb-3 flex min-w-0 items-center gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--teal-soft)] text-[10px] font-extrabold text-[var(--teal)]">
                  {initials(user)}
                </div>
                <div className="flex min-w-0 flex-col">
                  <strong className="truncate text-xs text-[var(--spruce)]">
                    {displayName(user)}
                  </strong>
                  <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-[var(--muted)]">
                    <UserRound size={12} aria-hidden="true" />
                    {user.email}
                  </span>
                </div>
              </div>
              {authenticated && <LogoutButton />}
            </section>
          </div>
        </div>
      )}

      <div className="main-shell">{children}</div>

      <nav
        className="mobile-nav"
        style={{ gridTemplateColumns: `repeat(${availableNavigation.length}, minmax(0, 1fr))` }}
        aria-label="Mobile primary navigation"
      >
        {availableNavigation.map((item) => {
          const active = routeIsActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              href={item.href}
              className={cn(active && "active")}
              aria-current={active ? "page" : undefined}
              key={item.href}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
