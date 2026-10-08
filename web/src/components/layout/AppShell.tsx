import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as authApi from '../../api/auth.api';
import * as dashboardApi from '../../api/dashboard.api';
import { useAuth } from '../../hooks/useAuth';
import { Icons, type IconName } from './icons';
import { ThemeToggle } from '../ThemeToggle';

/** One sidebar entry; sub-functions live inside section pages as tabs/actions. */
export interface NavNode {
  label: string;
  to?: string;
  icon?: IconName;
  badge?: 'ekyc';
  children?: NavNode[];
}

interface NavGroup {
  category: string;
  items: NavNode[];
}

const NAV_GROUPS: Record<string, NavGroup[]> = {
  ADMIN: [
    {
      category: 'Core Services',
      items: [
        { label: 'Dashboard', icon: 'dashboard', to: '/' },
        { label: 'CRS Synchronization', icon: 'sync', to: '/admin/crs' },
      ],
    },
    {
      category: 'Portals & Inventory',
      items: [
        { label: 'Agency Management', icon: 'agencies', to: '/admin/agencies' },
        { label: 'Agent Management', icon: 'agents', to: '/admin/agents' },
        { label: 'Resort Management', icon: 'resorts', to: '/admin/resorts' },
        { label: 'Pricing Management', icon: 'pricing', to: '/admin/pricing' },
        { label: 'Channel Inventory', icon: 'resorts', to: '/admin/inventory' },
      ],
    },
    {
      category: 'Operations',
      items: [
        { label: 'Booking Management', icon: 'bookings', to: '/admin/bookings' },
        { label: 'eKYC & Documents', icon: 'shield', badge: 'ekyc', to: '/applications' },
      ],
    },
    {
      category: 'Finance & Analytics',
      items: [
        { label: 'Finance & Ledger', icon: 'finance', to: '/admin/finance' },
        { label: 'Reports & Analytics', icon: 'reports', to: '/reports' },
      ],
    },
    {
      category: 'System Configuration',
      items: [
        { label: 'Notification Center', icon: 'bell', to: '/admin/notifications' },
        { label: 'Integrations', icon: 'integrations', to: '/admin/integrations' },
        { label: 'Audit Logs', icon: 'activity', to: '/audit' },
        { label: 'Security Controls', icon: 'lock', to: '/admin/security' },
        { label: 'System Settings', icon: 'settings', to: '/admin/settings' },
        { label: 'Support Ticket', icon: 'support', to: '/admin/support' },
      ],
    },
  ],
  VERIFIER: [
    {
      category: 'Overview',
      items: [
        { label: 'Dashboard', icon: 'dashboard', to: '/' },
        { label: 'Applications', icon: 'agencies', to: '/applications' },
        { label: 'Audit Logs', icon: 'activity', to: '/audit' },
      ],
    },
  ],
  AGENCY: [
    {
      category: 'Core Services',
      items: [
        { label: 'Dashboard', icon: 'dashboard', to: '/' },
        { label: 'Resort Search', icon: 'search', to: '/book' },
      ],
    },
    {
      category: 'Management',
      items: [
        { label: 'Agent Management', icon: 'agents', to: '/agency/agents' },
        { label: 'Booking Management', icon: 'bookings', to: '/agency/bookings' },
        { label: 'Guest Management', icon: 'agencies', to: '/agency/guests' },
      ],
    },
    {
      category: 'Finance & Reports',
      items: [
        { label: 'Payments & Credit', icon: 'finance', to: '/agency/payments' },
        { label: 'Reports & Ledger', icon: 'reports', to: '/agency/reports' },
      ],
    },
    {
      category: 'Account & Support',
      items: [
        { label: 'Notifications', icon: 'bell', to: '/agency/notifications' },
        { label: 'Profile & Company', icon: 'shield', to: '/agency/profile' },
        { label: 'Account Settings', icon: 'lock', to: '/agency/settings' },
        { label: 'Support Ticket', icon: 'support', to: '/agency/support' },
      ],
    },
  ],
  AGENT: [
    {
      category: 'Core Services',
      items: [
        { label: 'Dashboard', icon: 'dashboard', to: '/' },
        { label: 'Search & Book', icon: 'search', to: '/book' },
      ],
    },
    {
      category: 'Operational Logs',
      items: [
        { label: 'Booking Management', icon: 'bookings', to: '/agent/bookings' },
        { label: 'Guest Management', icon: 'agencies', to: '/agent/guests' },
      ],
    },
    {
      category: 'Preferences & Support',
      items: [
        { label: 'Notifications', icon: 'bell', to: '/agent/notifications' },
        { label: 'Profile & Company', icon: 'agents', to: '/agent/profile' },
        { label: 'Support Helpdesk', icon: 'support', to: '/agent/support' },
      ],
    },
  ],
};

const AGENT_MOBILE_NAV = [
  { label: 'Home', icon: 'dashboard' as const, to: '/' },
  { label: 'Book', icon: 'search' as const, to: '/book' },
  { label: 'Bookings', icon: 'bookings' as const, to: '/agent/bookings' },
  { label: 'Profile', icon: 'agents' as const, to: '/agent/profile' },
];

function initials(email?: string): string {
  if (!email) return '?';
  return email.slice(0, 2).toUpperCase();
}

let savedScrollTop = 0;

export function AppShell({ children, title: _title }: { children: ReactNode; title?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearSession } = useAuth();
  const groups = NAV_GROUPS[user?.role ?? ''] ?? [];
  const nodes = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Command palette options and features suggestion lookup
  const suggestedCommands = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const list: { label: string; category: string; icon: string; action: () => void }[] = [];

    // Auto-map sidebar navigation routes
    nodes.forEach((n) => {
      if (n.to) {
        list.push({
          label: n.label,
          category: 'Navigation',
          icon: n.icon ?? 'dashboard',
          action: () => navigate(n.to ?? '#'),
        });
      }
      n.children?.forEach((c) => {
        if (c.to) {
          list.push({
            label: `${n.label} → ${c.label}`,
            category: 'Navigation',
            icon: c.icon ?? n.icon ?? 'dashboard',
            action: () => navigate(c.to ?? '#'),
          });
        }
      });
    });

    // Theme switching control action
    list.push({
      label: 'Toggle Light / Dark Mode',
      category: 'Preferences',
      icon: 'dashboard',
      action: () => {
        const btn = document.querySelector('[aria-label="Toggle theme"], button.theme-toggle-btn') as HTMLButtonElement | null;
        if (btn) {
          btn.click();
        } else {
          const isDark = document.documentElement.classList.toggle('dark');
          localStorage.setItem('theme', isDark ? 'dark' : 'light');
        }
      },
    });

    // Session log out action
    list.push({
      label: 'Sign Out / Log Out',
      category: 'Session',
      icon: 'logout',
      action: handleLogout,
    });

    // Quick admin functions
    if (user?.role === 'ADMIN' || user?.role === 'VERIFIER') {
      list.push({
        label: 'Create Agency Profile',
        category: 'Quick Action',
        icon: 'agencies',
        action: () => navigate('/admin/agencies?action=create'),
      });
      list.push({
        label: 'Pending Registration Approvals',
        category: 'Quick Action',
        icon: 'agencies',
        action: () => navigate('/admin/agencies?tab=pending'),
      });
    }

    // Quick agent functions
    if (user?.role === 'AGENT' || user?.role === 'AGENCY') {
      list.push({
        label: 'Book Overnight Stay',
        category: 'Quick Action',
        icon: 'search',
        action: () => navigate('/book'),
      });
    }

    return list
      .filter((item) => item.label.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
      .slice(0, 6);
  }, [searchQuery, nodes, user, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSearchQuery(params.get('search') ?? '');
  }, [location]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setShowSuggestions(false);
    if (user?.role === 'ADMIN' || user?.role === 'VERIFIER') {
      navigate(`/admin/agencies?search=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      navigate(`/book?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const { data: summary } = useQuery({
    queryKey: ['admin-summary'],
    queryFn: dashboardApi.getAdminSummary,
    enabled: user?.role === 'ADMIN',
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const ekycCount = summary?.approvals?.ekycPending ?? 0;

  // --- Active-route detection (query-aware for tab/action leaves) ---
  const activePath = location.pathname;
  const current = activePath + location.search;
  const stripQuery = (to?: string) => (to ? to.split('?')[0] : '');
  const leafActive = (to?: string): boolean => {
    if (!to) return false;
    return to.includes('?') ? to === current : stripQuery(to) === activePath;
  };
  const nodeActive = (n: NavNode): boolean =>
    leafActive(n.to) || (n.children?.some(nodeActive) ?? false);

  // --- Accordion open state ---
  const nodeId = (label: string, parentId: string) => (parentId ? `${parentId}/${label}` : label);
  const activeOpenIds = (list: NavNode[], parentId = ''): string[] => {
    const ids: string[] = [];
    for (const n of list) {
      if (!n.children) continue;
      const id = nodeId(n.label, parentId);
      if (nodeActive(n)) {
        ids.push(id);
        ids.push(...activeOpenIds(n.children, id));
      }
    }
    return ids;
  };

  const [open, setOpen] = useState<Set<string>>(() => new Set(activeOpenIds(nodes)));

  useEffect(() => {
    setOpen((p) => {
      const next = new Set(p);
      activeOpenIds(nodes).forEach((id) => next.add(id));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  function toggleOpen(id: string) {
    setOpen((p) => {
      const next = new Set(p);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function setCollapsedPersist(next: boolean) {
    localStorage.setItem('sidebar_collapsed', next ? '1' : '0');
    setCollapsed(next);
  }

  async function handleLogout() {
    try {
      await authApi.logout();
    } finally {
      clearSession();
      navigate('/login');
    }
  }

  // --- Expanded (accordion) rendering ---
  function renderNode(node: NavNode, parentId: string, depth: number): ReactNode {
    const id = nodeId(node.label, parentId);
    const Icon = node.icon ? Icons[node.icon] : null;
    const showBadge = node.badge === 'ekyc' && ekycCount > 0;
    const badge = showBadge ? (
      <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{ekycCount}</span>
    ) : null;

    if (node.children) {
      const isOpen = open.has(id);
      const active = nodeActive(node);
      return (
        <div key={id}>
          <button
            onClick={() => toggleOpen(id)}
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-900 ${
              active ? 'font-medium text-blue-700 dark:text-blue-400' : depth === 0 ? 'text-slate-600 dark:text-slate-400' : 'text-slate-500 dark:text-slate-500'
            }`}
          >
            {Icon ? <Icon className="h-[18px] w-[18px] shrink-0" /> : <span className="w-1" />}
            <span className="flex-1 truncate text-left">{node.label}</span>
            {badge}
            <Icons.chevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
          </button>
          {isOpen && (
            <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-slate-100 dark:border-slate-800 pl-2">
              {node.children.map((c) => renderNode(c, id, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const active = leafActive(node.to);
    return (
      <Link
        key={id}
        to={node.to ?? '#'}
        className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm ${
          active ? 'bg-blue-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900'
        }`}
      >
        {Icon ? (
          <Icon className="h-[18px] w-[18px] shrink-0" />
        ) : (
          <span className={`ml-1 h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-white' : 'bg-slate-300 dark:bg-slate-700'}`} />
        )}
        <span className="flex-1 truncate">{node.label}</span>
        {badge}
      </Link>
    );
  }

  // --- Collapsed rendering ---
  function renderCollapsed(node: NavNode) {
    const Icon = node.icon ? Icons[node.icon] : Icons.settings;
    const showBadge = node.badge === 'ekyc' && ekycCount > 0;
    const active = nodeActive(node);
    const dot = showBadge ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" /> : null;

    if (node.children) {
      return (
        <button
          key={node.label}
          title={node.label}
          onClick={() => {
            setCollapsedPersist(false);
            setOpen((p) => new Set(p).add(node.label));
          }}
          className={`relative flex w-full items-center justify-center rounded-md px-2 py-1.5 ${
            active ? 'bg-blue-50 text-blue-700 dark:bg-slate-900 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
          }`}
        >
          <Icon className="h-[18px] w-[18px]" />
          {dot}
        </button>
      );
    }
    return (
      <NavLink
        key={node.label}
        to={node.to ?? '#'}
        end={node.to === '/'}
        title={node.label}
        className={({ isActive }) =>
          `relative flex items-center justify-center rounded-md px-2 py-1.5 ${
            isActive ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900'
          }`
        }
      >
        <Icon className="h-[18px] w-[18px]" />
        {dot}
      </NavLink>
    );
  }

  const renderSidebar = (compact: boolean) => (
    <>
      <div className={`flex items-center gap-2 py-4 ${compact ? 'justify-center px-2' : 'px-4'}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Icons.resorts className="h-5 w-5" />
        </div>
        {!compact && (
          <div className="leading-tight text-left">
            <div className="text-sm font-bold text-slate-900 dark:text-white">Resort B2B</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {user?.role === 'ADMIN' ? 'Admin Panel' : 'Portal'}
            </div>
          </div>
        )}
      </div>

      <nav
        ref={(el) => {
          if (el && !compact) {
            el.scrollTop = savedScrollTop;
          }
        }}
        onScroll={(e) => {
          if (!compact) {
            savedScrollTop = e.currentTarget.scrollTop;
          }
        }}
        className="flex-1 overflow-y-auto px-2 pb-2 space-y-4"
      >
        {groups.map((group) => (
          <div key={group.category} className="space-y-1">
            {!compact && (
              <div className="px-3 pt-3 pb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.category}
              </div>
            )}
            {compact && <div className="border-t border-slate-100 dark:border-slate-800/40 my-2 first:hidden" />}
            <div className="space-y-0.5">
              {group.items.map((n) => (compact ? renderCollapsed(n) : renderNode(n, '', 0)))}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle (desktop only) */}
      <button
        onClick={() => setCollapsedPersist(!collapsed)}
        className={`hidden items-center gap-2 border-t border-slate-100 dark:border-slate-900 py-2 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900 lg:flex ${compact ? 'justify-center px-2' : 'px-4'}`}
        title={compact ? 'Expand' : 'Collapse'}
      >
        <Icons.chevronLeft className={`h-4 w-4 transition-transform ${compact ? 'rotate-180' : ''}`} />
        {!compact && <span>Collapse</span>}
      </button>

      <div className="border-t border-slate-100 dark:border-slate-900 p-2">
        <div className={`flex items-center gap-2.5 rounded-md py-1.5 ${compact ? 'justify-center px-0' : 'px-2'}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white" title={user?.email}>
            {initials(user?.email)}
          </div>
          {!compact && (
            <div className="min-w-0 flex-1 leading-tight text-left">
              <div className="truncate text-xs font-medium text-slate-900 dark:text-white">{user?.role}</div>
              <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{user?.email}</div>
            </div>
          )}
          {!compact && (
            <button onClick={handleLogout} title="Log out" className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300">
              <Icons.logout className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      {/* Desktop sidebar */}
      <aside className={`fixed inset-y-0 left-0 hidden flex-col border-r border-slate-200 bg-white transition-all lg:flex dark:border-slate-800 dark:bg-slate-950 ${collapsed ? 'w-16' : 'w-60'}`}>
        {renderSidebar(collapsed)}
      </aside>

      {/* Mobile drawer (always full labels, disabled for agents as they have bottom nav) */}
      {mobileOpen && user?.role !== 'AGENT' && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 dark:bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white dark:bg-slate-950 shadow-xl border-r border-slate-200 dark:border-slate-800">{renderSidebar(false)}</aside>
        </div>
      )}

      {/* Main column — min-w-0 lets wide children (tables, etc.) scroll
          within their own overflow container instead of widening the page. */}
      <div className={`flex min-h-screen min-w-0 flex-1 flex-col transition-all ${collapsed ? 'lg:ml-16' : 'lg:ml-60'} ${user?.role === 'AGENT' ? 'lg:ml-60' : ''}`}>
        <header className="sticky top-0 z-30 flex items-center gap-2.5 sm:gap-3 border-b border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-950/90 px-3 sm:px-4 lg:px-6 py-2 sm:py-2.5 backdrop-blur">
          {user?.role !== 'AGENT' && (
            <button className="text-slate-500 dark:text-slate-400 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
              <Icons.menu className="h-5 w-5" />
            </button>
          )}
          <div className="relative">
            <form onSubmit={handleSearchSubmit} className="hidden items-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-900 px-3 py-1 text-sm text-slate-450 sm:flex border border-transparent focus-within:border-slate-205 dark:focus-within:border-slate-800 transition-all">
              <Icons.search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 250)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                placeholder="Search..."
                className="bg-transparent border-0 outline-none text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 w-32 focus:w-48 transition-all py-0.5"
              />
            </form>

            {showSuggestions && searchQuery.trim() && suggestedCommands.length > 0 && (
              <div className="absolute top-full left-0 mt-1.5 w-64 rounded-xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-950 p-2 shadow-xl z-50 animate-fade-up">
                <div>
                  <div className="px-2.5 py-1 text-[9px] font-bold text-slate-400 dark:text-slate-505 uppercase tracking-wider">Features & Options</div>
                  <div className="space-y-0.5">
                    {suggestedCommands.map((cmd, index) => {
                      const Icon = Icons[cmd.icon as keyof typeof Icons] || Icons.dashboard;
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            setShowSuggestions(false);
                            setSearchQuery('');
                            cmd.action();
                          }}
                          className="w-full text-left px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-lg flex items-center gap-2 transition-colors group"
                        >
                          <div className="p-1 rounded-md bg-slate-100/80 dark:bg-slate-900 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40 text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 truncate">
                            <div className="truncate text-slate-800 dark:text-slate-205">{cmd.label}</div>
                            <div className="text-[9px] text-slate-400 dark:text-slate-500 font-normal">{cmd.category}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <button className="relative text-slate-400 hover:text-slate-700 dark:text-slate-505 dark:hover:text-slate-300" aria-label="Notifications">
              <Icons.bell className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">
                {initials(user?.email)}
              </div>
              <span className="hidden text-sm text-slate-600 dark:text-slate-400 sm:inline">{user?.role}</span>
            </div>
            <button onClick={handleLogout} title="Log out" className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300">
              <Icons.logout className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className={`flex-1 p-2.5 sm:p-4 lg:p-6 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 ${user?.role === 'AGENT' ? 'pb-24 lg:pb-6' : ''}`}>
          {children}
        </main>
      </div>

      {/* Floating glassmorphic bottom nav for agent on small screens */}
      {user?.role === 'AGENT' && (
        <div className="fixed bottom-4 inset-x-4 z-40 lg:hidden">
          <nav className="glass-nav mx-auto flex h-16 max-w-md items-center justify-around rounded-2xl px-2 shadow-lg">
            {AGENT_MOBILE_NAV.map((item) => {
              const active = leafActive(item.to);
              const Icon = Icons[item.icon];
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={`flex flex-col items-center justify-center w-16 h-12 rounded-xl transition-all ${
                    active
                      ? 'text-blue-600 dark:text-blue-400 font-semibold scale-105'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                  }`}
                >
                  <Icon className="h-5 w-5 mb-0.5" />
                  <span className="text-[10px] tracking-wide font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
