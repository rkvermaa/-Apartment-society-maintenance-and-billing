const path = require('node:path');

module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: process.env.DATABASE_FILENAME || path.join(__dirname, 'dev.sqlite3'),
  },
  useNullAsDefault: true,
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    extension: 'cjs',
  },
};
