module.exports = [
  {
    ignores: ['scripts/node_modules/**', 'scripts/coverage/**']
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly'
      }
    },
    rules: {
      semi: ['error', 'always'],
      quotes: ['error', 'single'],
      'no-console': 'off'
    }
  },
  {
    files: ['scripts/**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly'
      }
    }
  }
];
