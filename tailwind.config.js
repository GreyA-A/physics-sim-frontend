/** @type {import('tailwindcss').Config} */
export default {
  // Шляхи, у яких Tailwind шукає класи (інакше невикористані стилі не потраплять у збірку)
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Темна тема перемикається класом "dark" на <html> (знадобиться в Issue #3)
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};