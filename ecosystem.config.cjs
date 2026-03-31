module.exports = {
  apps: [
    {
      name: 'webapp-dev',
      script: 'npx',
      args: 'vite preview --port 3000 --host 0.0.0.0',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
