exports.up = function up(knex) {
  return knex.schema.alterTable('flats', (table) => {
    table.boolean('is_active').notNullable().defaultTo(true);
    table.decimal('monthly_maintenance_amount', 10, 2).nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('flats', (table) => {
    table.dropColumn('is_active');
    table.dropColumn('monthly_maintenance_amount');
  });
};
