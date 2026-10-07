import type { IncomingMessage } from 'node:http';
import type { RouteRule } from './types';

export type Matcher = (method: string, path: string) => boolean;
type Methods = Set<string> | null; // null = any method

const SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** Drop the query string and a trailing slash; never shorter than '/'. */
export function normalizePath(path: string): string {
  const end = path.indexOf('?');
  let p = end === -1 ? path : path.slice(0, end);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

/** Express sets `req.path` (relative to the router) and `req.baseUrl` (mount point); plain Node only has `req.url`. */
export function getRequestPath(req: IncomingMessage & { path?: unknown; baseUrl?: unknown }): string {
  return normalizePath(typeof req.path === 'string' ? `${req.baseUrl || ''}${req.path}` : req.url || '/');
}

/** `:param` matches one segment, `*` matches anything, everything else is literal. */
export function patternToRegExp(pattern: string, caseSensitive: boolean): RegExp {
  const source = normalizePath(pattern)
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(SPECIALS, '\\$&').replace(/\\\*/g, '.*')))
    .join('/');
  return new RegExp(`^${source}$`, caseSensitive ? '' : 'i');
}

function normalizeMethods(methods: unknown, index: number): Methods {
  const set = new Set<string>();
  for (const m of methods == null ? [] : ([] as unknown[]).concat(methods)) {
    if (typeof m !== 'string' || !m) throw new TypeError(`routes[${index}].methods must be a non-empty string or an array of strings`);
    if (m === '*' || m.toLowerCase() === 'all') return null;
    set.add(m.toUpperCase());
  }
  return set.size ? set : null;
}

/**
 * Compile route rules into `(method, path) => boolean`, or null when there are no rules (limit everything).
 * Exact paths live in a Map; `:param`/`*` patterns and RegExps in a list that is scanned only on a miss.
 */
export function compileRoutes(routes: readonly RouteRule[] | null | undefined, caseSensitive = false): Matcher | null {
  if (routes == null) return null;
  if (!Array.isArray(routes)) throw new TypeError('routes must be an array');
  if (!routes.length) return null;
  const exact = new Map<string, Methods>();
  const patterns: Array<{ re: RegExp; methods: Methods }> = [];
  routes.forEach((rule: RouteRule | null, i) => {
    if (rule === null || typeof rule !== 'object') throw new TypeError(`routes[${i}] must be an object like { path, methods }`);
    const methods = normalizeMethods(rule.methods ?? rule.method, i);
    const { path } = rule;
    if (path instanceof RegExp) {
      patterns.push({ re: path, methods });
    } else if (typeof path !== 'string' || !path) {
      throw new TypeError(`routes[${i}].path must be a non-empty string or a RegExp`);
    } else if (/[:*]/.test(path)) {
      patterns.push({ re: patternToRegExp(path, caseSensitive), methods });
    } else {
      const key = caseSensitive ? normalizePath(path) : normalizePath(path).toLowerCase();
      const existing = exact.get(key);
      // several rules for one path merge; "any method" absorbs the rest
      exact.set(key, existing === null || methods === null ? null : existing ? new Set([...existing, ...methods]) : methods);
    }
  });
  const allows = (methods: Methods, method: string) => methods === null || methods.has(method);
  return (method, path) => {
    const p = caseSensitive ? path : path.toLowerCase();
    const found = exact.get(p);
    if (found !== undefined && allows(found, method)) return true;
    return patterns.some((rule) => allows(rule.methods, method) && rule.re.test(p));
  };
}
