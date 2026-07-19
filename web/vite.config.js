import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  return {
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
  };
});
