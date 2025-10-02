const baseConfig = require('./jest.config.base.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  roots: ['<rootDir>/tests/e2e'],
  maxWorkers: 1,
  testTimeout: 30000,
};
