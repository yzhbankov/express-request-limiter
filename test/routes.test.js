import { compileRoutes, getRequestPath, normalizePath, patternToRegExp } from '../src/routes';

describe('normalizePath', () => {
  test.each([
    ['/', '/'],
    ['', '/'],
    ['/a', '/a'],
    ['/a/', '/a'],
    ['/a/b/', '/a/b'],
    ['/a?x=1', '/a'],
    ['/a/?x=1&y=2', '/a'],
    ['?x=1', '/'],
  ])('%p -> %p', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('getRequestPath', () => {
  test('uses baseUrl + path when Express populated them', () => {
    expect(getRequestPath({ path: '/items', baseUrl: '/api', url: '/items?x=1' })).toBe('/api/items');
  });

  test('uses path alone at the app level', () => {
    expect(getRequestPath({ path: '/items/', baseUrl: '', url: '/items/?x=1' })).toBe('/items');
  });

  test('falls back to url for plain Node requests', () => {
    expect(getRequestPath({ url: '/raw/path/?q=1' })).toBe('/raw/path');
    expect(getRequestPath({})).toBe('/');
  });
});

describe('patternToRegExp', () => {
  test(':param matches exactly one segment', () => {
    const re = patternToRegExp('/users/:id', true);
    expect(re.test('/users/42')).toBe(true);
    expect(re.test('/users/42/posts')).toBe(false);
    expect(re.test('/users')).toBe(false);
  });

  test('* matches across segments', () => {
    const re = patternToRegExp('/api/*', true);
    expect(re.test('/api/a')).toBe(true);
    expect(re.test('/api/a/b/c')).toBe(true);
    expect(re.test('/apix')).toBe(false);
  });

  test('escapes regex metacharacters in literal segments', () => {
    const re = patternToRegExp('/v1.0/items+(a)', true);
    expect(re.test('/v1.0/items+(a)')).toBe(true);
    expect(re.test('/v1x0/items+(a)')).toBe(false);
  });

  test('is case-insensitive unless asked otherwise', () => {
    expect(patternToRegExp('/Api/:id', false).test('/api/1')).toBe(true);
    expect(patternToRegExp('/Api/:id', true).test('/api/1')).toBe(false);
  });
});

describe('compileRoutes', () => {
  test('returns null for no rules, meaning "limit everything"', () => {
    expect(compileRoutes(undefined)).toBeNull();
    expect(compileRoutes(null)).toBeNull();
    expect(compileRoutes([])).toBeNull();
  });

  test('matches exact paths for the listed methods only', () => {
    const match = compileRoutes([{ path: '/a', methods: ['GET', 'post'] }]);
    expect(match('GET', '/a')).toBe(true);
    expect(match('POST', '/a')).toBe(true);
    expect(match('DELETE', '/a')).toBe(false);
    expect(match('GET', '/b')).toBe(false);
  });

  test('a single method string is accepted', () => {
    const match = compileRoutes([{ path: '/a', methods: 'put' }]);
    expect(match('PUT', '/a')).toBe(true);
    expect(match('GET', '/a')).toBe(false);
  });

  test('accepts the legacy `method` field', () => {
    const match = compileRoutes([{ path: '/a', method: 'GET' }]);
    expect(match('GET', '/a')).toBe(true);
    expect(match('POST', '/a')).toBe(false);
  });

  test.each([undefined, null, '*', 'all', 'ALL', [], ['*'], ['GET', 'all']])('methods %p means every method', (methods) => {
    const match = compileRoutes([{ path: '/a', methods }]);
    expect(match('GET', '/a')).toBe(true);
    expect(match('OPTIONS', '/a')).toBe(true);
  });

  test('ignores trailing slashes on both sides', () => {
    const match = compileRoutes([{ path: '/a/' }]);
    expect(match('GET', '/a')).toBe(true);
    expect(match('GET', normalizePath('/a/'))).toBe(true);
  });

  test('is case-insensitive by default like Express', () => {
    const match = compileRoutes([{ path: '/Users' }]);
    expect(match('GET', '/users')).toBe(true);
    expect(match('GET', '/USERS')).toBe(true);
  });

  test('honours caseSensitive', () => {
    const match = compileRoutes([{ path: '/Users' }], true);
    expect(match('GET', '/Users')).toBe(true);
    expect(match('GET', '/users')).toBe(false);
  });

  test('supports :param patterns', () => {
    const match = compileRoutes([{ path: '/users/:id', methods: ['GET'] }]);
    expect(match('GET', '/users/1')).toBe(true);
    expect(match('GET', '/users/1/x')).toBe(false);
    expect(match('POST', '/users/1')).toBe(false);
  });

  test('supports * wildcards', () => {
    const match = compileRoutes([{ path: '/api/*' }]);
    expect(match('GET', '/api/anything/deep')).toBe(true);
    expect(match('GET', '/api')).toBe(false);
    expect(match('GET', '/other')).toBe(false);
  });

  test('supports RegExp paths', () => {
    const match = compileRoutes([{ path: /^\/v\d+\/items$/, methods: ['GET'] }]);
    expect(match('GET', '/v2/items')).toBe(true);
    expect(match('GET', '/v2/itemsx')).toBe(false);
    expect(match('POST', '/v2/items')).toBe(false);
  });

  test('merges methods when the same path is listed twice', () => {
    const match = compileRoutes([
      { path: '/a', methods: ['GET'] },
      { path: '/a', methods: ['POST'] },
    ]);
    expect(match('GET', '/a')).toBe(true);
    expect(match('POST', '/a')).toBe(true);
    expect(match('PUT', '/a')).toBe(false);
  });

  test('an all-methods rule widens a method-specific rule for the same path', () => {
    const match = compileRoutes([{ path: '/a', methods: ['GET'] }, { path: '/a' }]);
    expect(match('PUT', '/a')).toBe(true);
    const match2 = compileRoutes([{ path: '/a' }, { path: '/a', methods: ['GET'] }]);
    expect(match2('PUT', '/a')).toBe(true);
  });

  test('exact rules and pattern rules combine', () => {
    const match = compileRoutes([{ path: '/health', methods: ['GET'] }, { path: '/api/*', methods: ['POST'] }]);
    expect(match('GET', '/health')).toBe(true);
    expect(match('POST', '/health')).toBe(false);
    expect(match('POST', '/api/x')).toBe(true);
    expect(match('GET', '/api/x')).toBe(false);
  });

  test('rejects invalid input with descriptive errors', () => {
    expect(() => compileRoutes('nope')).toThrow(/routes must be an array/);
    expect(() => compileRoutes([null])).toThrow(/routes\[0\] must be an object/);
    expect(() => compileRoutes([{ path: '' }])).toThrow(/routes\[0\]\.path/);
    expect(() => compileRoutes([{ path: 42 }])).toThrow(/routes\[0\]\.path/);
    expect(() => compileRoutes([{ path: '/a', methods: [1] }])).toThrow(/routes\[0\]\.methods/);
    expect(() => compileRoutes([{ path: '/a', methods: [''] }])).toThrow(/routes\[0\]\.methods/);
  });
});
