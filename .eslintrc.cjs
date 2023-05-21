module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'eslint-config-airbnb-base',
  ],
  overrides: [],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  rules: {
    'prettier/prettier': 'warn',
    'no-console': 'off',
    'no-plusplus': 'off',
    'no-bitwise': 'off',
    'import/no-unresolved': 'off',
    'import/extensions': 'off',
    'operator-linebreak': 'off',
  },
};
