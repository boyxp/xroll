/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        unused: '#0a84ff',
        used: '#8e8e93',
        deleted: '#1c1c1e',
        xred: '#ff3b30',
        accent: '#0a84ff'
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'PingFang SC',
          'Helvetica Neue',
          'sans-serif'
        ]
      }
    }
  },
  plugins: []
}
