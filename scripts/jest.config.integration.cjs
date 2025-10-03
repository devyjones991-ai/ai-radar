const baseConfig = require('./jest.config.base.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  roots: ['<rootDir>/tests/integration'],
  maxWorkers: 1,
  testTimeout: 120000,
};
