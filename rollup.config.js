export default {
  input: 'src/hs-player.js',
  output: [
    {
      file: 'example/hsPlayer.js',
      format: 'iife',
      name: 'HSPlayer',
      sourcemap: true // 'inline'
    }
  ],
}