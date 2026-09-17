exports.up = function up(knex) {
  return knex.schema.alterTable('bills', (table) => {
    table.unique(['flat_id', 'billing_period']);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('bills', (table) => {
    table.dropUnique(['flat_id', 'billing_period']);
  });
};
