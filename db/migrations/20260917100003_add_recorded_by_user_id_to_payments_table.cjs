exports.up = function up(knex) {
  return knex.schema.alterTable('payments', (table) => {
    table.integer('recorded_by_user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('payments', (table) => {
    table.dropColumn('recorded_by_user_id');
  });
};
