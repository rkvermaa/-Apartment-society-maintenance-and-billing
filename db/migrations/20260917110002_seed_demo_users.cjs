const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const DEMO_USERS = [
  { name: 'Demo Admin', email: 'admin', password: 'admin123', role: 'admin' },
  { name: 'Demo Resident', email: 'resident', password: 'resident123', role: 'resident' },
];

exports.up = async function up(knex) {
  const roleIds = {};
  for (const user of DEMO_USERS) {
    let role = await knex('roles').where({ name: user.role }).first();
    if (!role) {
      const [inserted] = await knex('roles').insert({ name: user.role }).returning('id');
      role = { id: inserted.id };
    }
    roleIds[user.role] = role.id;
  }

  for (const user of DEMO_USERS) {
    const existing = await knex('users').where({ email: user.email }).first();
    if (!existing) {
      await knex('users').insert({
        name: user.name,
        email: user.email,
        password_hash: hashPassword(user.password),
        role_id: roleIds[user.role],
      });
    }
  }
};

exports.down = function down(knex) {
  return knex('users').whereIn('email', DEMO_USERS.map((u) => u.email)).del();
};
