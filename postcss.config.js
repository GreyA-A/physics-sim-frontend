// Tailwind CSS v3 підключається як PostCSS-плагін разом з autoprefixer
// (для v4 конфігурація інша, тому у package.json зафіксовано ^3.4.17)
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};