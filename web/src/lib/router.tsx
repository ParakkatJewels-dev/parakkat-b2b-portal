'use client';

/**
 * The slice of the react-router-dom API the screens use, implemented on Next.js navigation.
 *
 * Routing itself is Next.js file-based routing (web/app/**); this module only keeps the
 * screens' call sites unchanged (`<Link to>`, `useNavigate()`, `useSearchParams()` returning a
 * tuple, ...), so the move to Next.js did not have to touch every page's logic.
 */
import NextLink from 'next/link';
import {
  useParams as useNextParams,
  usePathname,
  useRouter,
  useSearchParams as useNextSearchParams,
} from 'next/navigation';
import { useCallback, useEffect, useMemo, type AnchorHTMLAttributes, type ReactNode } from 'react';

type To = string;

interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

// react-router carried `state` on the history entry. Next.js navigation has no equivalent, so
// state travels in memory to the next screen that asks for it — the same lifetime it had for
// in-app navigation (it was never meant to survive a full reload).
let pendingState: { pathname: string; state: unknown } | null = null;

function pathOf(to: To): string {
  return new URL(to, 'http://local').pathname;
}

export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (to: To | number, options: NavigateOptions = {}) => {
      if (typeof to === 'number') {
        if (to < 0) router.back();
        else router.forward();
        return;
      }
      pendingState = options.state === undefined ? null : { pathname: pathOf(to), state: options.state };
      if (options.replace) router.replace(to);
      else router.push(to);
    },
    [router],
  );
}

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

export function useLocation(): Location {
  const pathname = usePathname() ?? '/';
  const params = useNextSearchParams();
  const search = params?.toString() ? `?${params.toString()}` : '';
  const state = pendingState && pendingState.pathname === pathname ? pendingState.state : undefined;
  return { pathname, search, hash: '', state };
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const params = useNextParams() ?? {};
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) flat[key] = Array.isArray(value) ? value.join('/') : value;
  return flat as T;
}

type SearchParamsInit = URLSearchParams | Record<string, string> | string;

export function useSearchParams(): [
  URLSearchParams,
  (next: SearchParamsInit | ((prev: URLSearchParams) => SearchParamsInit), options?: NavigateOptions) => void,
] {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const current = useNextSearchParams();
  const params = useMemo(() => new URLSearchParams(current?.toString() ?? ''), [current]);
  const setParams = useCallback(
    (next: SearchParamsInit | ((prev: URLSearchParams) => SearchParamsInit), options: NavigateOptions = {}) => {
      const value = typeof next === 'function' ? next(new URLSearchParams(params)) : next;
      const query = new URLSearchParams(value as URLSearchParams | Record<string, string> | string).toString();
      const href = query ? `${pathname}?${query}` : pathname;
      if (options.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [params, pathname, router],
  );
  return [params, setParams];
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

export interface LinkProps extends AnchorProps {
  to: To;
  replace?: boolean;
  state?: unknown;
  children?: ReactNode;
}

export function Link({ to, replace, state, onClick, ...rest }: LinkProps) {
  return (
    <NextLink
      href={to}
      replace={replace}
      onClick={(event) => {
        if (state !== undefined) pendingState = { pathname: pathOf(to), state };
        onClick?.(event);
      }}
      {...rest}
    />
  );
}

interface NavLinkRenderProps {
  isActive: boolean;
}

export interface NavLinkProps extends Omit<LinkProps, 'className' | 'children' | 'style'> {
  end?: boolean;
  className?: string | ((props: NavLinkRenderProps) => string);
  children?: ReactNode | ((props: NavLinkRenderProps) => ReactNode);
}

export function NavLink({ to, end, className, children, ...rest }: NavLinkProps) {
  const pathname = usePathname() ?? '/';
  const target = pathOf(to);
  const isActive = end || target === '/'
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target.replace(/\/$/, '')}/`);
  return (
    <Link
      to={to}
      aria-current={isActive ? 'page' : undefined}
      className={typeof className === 'function' ? className({ isActive }) : className}
      {...rest}
    >
      {typeof children === 'function' ? children({ isActive }) : children}
    </Link>
  );
}

export function Navigate({ to, replace }: { to: To; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);
  return null;
}
