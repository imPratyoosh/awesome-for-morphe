import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const cacheBustPlugin = () => {
  return {
    name: "cache-bust",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(
        /(assets\/index\.(?:js|css))/g,
        `$1?v=${Date.now()}`
      );
    }
  };
};

export default defineConfig(({ command }) => {
  return {
    plugins: [tailwindcss(), cacheBustPlugin()],
    publicDir: command === "serve" ? "../docs" : false,
    base: "./",
    build: {
      outDir: "../docs",
      emptyOutDir: false,
      rollupOptions: {
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name].[ext]",
        },
      },
    },
    resolve: {
      alias: {
        vue: "vue/dist/vue.esm-bundler.js",
      },
    },
  };
});
