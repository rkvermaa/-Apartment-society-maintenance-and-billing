exports.up = function up(knex) {
  return knex.schema.alterTable('flats', (table) => {
    table.string('updated_by').nullable();
    table.timestamp('updated_at').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('flats', (table) => {
    table.dropColumn('updated_by');
    table.dropColumn('updated_at');
  });
};
