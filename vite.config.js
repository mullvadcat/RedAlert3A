export default {
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0
  },
  assetsInclude: ['**/*.ktx2', '**/*.glb', '**/*.ogg']
};
