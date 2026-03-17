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
        slideDown: {
          from: { opacity: '0', transform: 'translate(-50%, -60%)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%)' },
        },
      },
      animation: {
        slideDown: 'slideDown 0.25s ease-out',
      },
    },
  },
  plugins: [preline],
};
