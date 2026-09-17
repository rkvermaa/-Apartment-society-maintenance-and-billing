exports.up = function up(knex) {
  return knex.schema.alterTable('users', (table) => {
    table.string('username').unique();
    table.boolean('is_active').notNullable().defaultTo(true);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('users', (table) => {
    table.dropColumn('username');
    table.dropColumn('is_active');
  });
};
