// PM2 ecosystem.config.js
// Usar: pm2 start ecosystem.config.js
// En Plesk: Node.js app → Application startup file: ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'oldface-backend',
      script: './backend/server.js',
      cwd: '/var/www/oldface',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // El resto de variables las lee desde .env del backend
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/var/log/oldface/backend-error.log',
      out_file:   '/var/log/oldface/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
