process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

describe('src/instrument', () => {
  const ORIGINAL_DSN = process.env.SENTRY_DSN;

  afterEach(() => {
    process.env.SENTRY_DSN = ORIGINAL_DSN;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('initializes Sentry when SENTRY_DSN is set', async () => {
    const initMock = jest.fn();
    jest.doMock('@sentry/node', () => ({ init: initMock }));

    process.env.SENTRY_DSN = 'test-dsn';
    await import('../src/instrument');

    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it('does not initialize Sentry when SENTRY_DSN is not set', async () => {
    const initMock = jest.fn();
    jest.doMock('@sentry/node', () => ({ init: initMock }));

    delete process.env.SENTRY_DSN;
    await import('../src/instrument');

    expect(initMock).not.toHaveBeenCalled();
  });
});

