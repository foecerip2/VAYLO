module.exports = {
  presets: [require('../../packages/ui/tailwind-preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}', '../../packages/support/src/**/*.{ts,tsx}'],
};
