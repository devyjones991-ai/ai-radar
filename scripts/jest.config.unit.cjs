const baseConfig = require('./jest.config.base.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  roots: ['<rootDir>/tests/unit'],
};
