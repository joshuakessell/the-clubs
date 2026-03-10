import preline from "preline/plugin";

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/**/*.{js,ts,jsx,tsx}",
    "node_modules/preline/dist/*.js"
  ],
  theme: {
    extend: {
      keyframes: {
        fadeSlideIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeSlideIn: 'fadeSlideIn 0.3s ease-out forwards',
      },
    },
  },
  plugins: [preline],
};
