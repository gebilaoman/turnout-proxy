import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/', '.wxt/', 'spikes/', 'docs/', 'public/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // 以 _ 开头表示有意丢弃（如解构时去掉某个字段）
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    // 端到端脚本在 Node 中运行，传给 evaluate 的回调在浏览器 / 扩展上下文中运行
    files: ['e2e/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', chrome: 'readonly', document: 'readonly', location: 'readonly', window: 'readonly' },
    },
    rules: { 'no-control-regex': 'off' },
  },
  {
    // core 必须是纯 TypeScript：禁止依赖浏览器 API、WXT 与其他层（CLAUDE.md「目录与依赖方向」）
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'chrome', 'browser', 'window', 'document', 'localStorage', 'fetch'],
      'no-restricted-imports': ['error', { patterns: ['wxt', 'wxt/*', '#imports', '@/platform/*', '@/entrypoints/*', '@/ui/*', '**/platform/**', '**/entrypoints/**', '**/ui/**'] }],
    },
  },
);
