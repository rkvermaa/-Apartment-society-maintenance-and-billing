const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

async function resetAdminPassword(db, { email, newPassword, performedBy }) {
  const admin = await db('users')
    .join('roles', 'roles.id', 'users.role_id')
    .where({ 'users.email': email, 'roles.name': 'admin' })
    .select('users.id')
    .first();

  if (!admin) {
    throw new Error(`No admin user found with email "${email}"`);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const resetAt = new Date();

  await db('users').where({ id: admin.id }).update({
    password_hash: passwordHash,
    password_reset_at: resetAt,
  });

  await db('audit_logs').insert({
    action: 'admin_password_reset',
    target_user_id: admin.id,
    target_email: email,
    performed_by: performedBy,
    created_at: resetAt,
  });

  return { userId: admin.id, resetAt };
}

module.exports = { resetAdminPassword };

if (require.main === module) {
  (async () => {
    const [, , email, newPassword] = process.argv;
    if (!email || !newPassword) {
      console.error('Usage: node scripts/resetAdminPassword.cjs <admin-email> <new-password>');
      process.exitCode = 1;
      return;
    }

    const os = require('node:os');
    const knex = require('knex')(require('../db/knexfile.cjs'));
    try {
      const { userId, resetAt } = await resetAdminPassword(knex, {
        email,
        newPassword,
        performedBy: os.userInfo().username,
      });
      console.log(
        JSON.stringify({ event: 'admin_password_reset', userId, resetAt, timestamp: new Date().toISOString() }),
      );
    } catch (err) {
      console.error(JSON.stringify({ event: 'admin_password_reset_failed', error: err.message }));
      process.exitCode = 1;
    } finally {
      await knex.destroy();
    }
  })();
}
