const ORIGINAL_ENV = { ...process.env };

const mockPoolInstance = { query: jest.fn(), end: jest.fn() };

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

const PoolMock = jest.fn(() => mockPoolInstance);

jest.mock('pg', () => ({
  Pool: PoolMock,
}));

describe('createPool', () => {
  function reloadModule() {
    jest.isolateModules(() => {
      ({ createPool } = require('../../memory-service'));
    });
  }

  let createPool;

  beforeEach(() => {
    jest.resetModules();
    PoolMock.mockClear();
    mockPoolInstance.query.mockReset();
    mockPoolInstance.end.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PORT;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('использует переменные окружения POSTGRES_* для конфигурации', () => {
    process.env.POSTGRES_HOST = 'env-host';
    process.env.POSTGRES_PORT = '6432';
    process.env.POSTGRES_DB = 'env-db';
    process.env.POSTGRES_USER = 'env-user';
    process.env.POSTGRES_PASSWORD = 'env-pass';
    process.env.DATABASE_URL = 'postgres://should-not-be-used';

    reloadModule();

    createPool();

    expect(PoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'env-host',
        port: 6432,
        database: 'env-db',
        user: 'env-user',
        password: 'env-pass',
      })
    );
  });

  it('падает обратно на DATABASE_URL при отсутствии POSTGRES_*', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@env-host:5432/env-db';

    reloadModule();

    createPool();

    expect(PoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://user:pass@env-host:5432/env-db',
      })
    );
  });

  it('позволяет переопределять конфигурацию с помощью опций', () => {
    process.env.POSTGRES_HOST = 'env-host';
    process.env.POSTGRES_DB = 'env-db';

    reloadModule();

    createPool({
      host: 'custom-host',
      port: '7777',
      password: 'custom-pass',
      max: 20,
    });

    expect(PoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'custom-host',
        port: 7777,
        database: 'env-db',
        password: 'custom-pass',
        max: 20,
      })
    );
  });

  it('использует connectionString из опций, если он передан', () => {
    process.env.POSTGRES_HOST = 'env-host';
    process.env.DATABASE_URL = 'postgres://should-not-be-used';

    reloadModule();

    createPool({
      connectionString: 'postgres://user:pass@custom:5432/custom',
      max: 15,
    });

    expect(PoolMock).toHaveBeenCalledWith({
      connectionString: 'postgres://user:pass@custom:5432/custom',
      max: 15,
    });
  });
});
