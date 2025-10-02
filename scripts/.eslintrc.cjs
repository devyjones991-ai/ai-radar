module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
  },
  rules: {
    semi: ['error', 'always'],
  },
  ignorePatterns: ['node_modules/', 'tests/**/*.test.js'],
};
