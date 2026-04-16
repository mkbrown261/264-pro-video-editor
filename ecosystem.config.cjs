module.exports = {
  apps: [
    {
      name: 'webapp-264pro',
      script: 'node',
      args: 'serve.mjs',
      cwd: '/home/user/264pro',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
