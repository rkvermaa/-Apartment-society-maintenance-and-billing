exports.up = function up(knex) {
  return knex.schema.alterTable('users', (table) => {
    table.timestamp('password_reset_at').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('users', (table) => {
    table.dropColumn('password_reset_at');
  });
};
